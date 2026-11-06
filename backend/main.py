import asyncio
import base64
import datetime
import hashlib
import hmac
import json
import logging
import os
import re
import secrets
import tempfile
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Annotated

import bcrypt
from bson import ObjectId
from fastapi import Depends, FastAPI, File, HTTPException, Request, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, field_validator
from pymongo.errors import DuplicateKeyError, PyMongoError
from starlette.websockets import WebSocketDisconnected

from database import (
    database,
    message_collection,
    user_collection,
    world_game_collection,
    world_memory_collection,
)

logger = logging.getLogger(__name__)
ADMIN_USERNAME = os.getenv("ADMIN_USERNAME", "").strip()
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "")
AUTH_SECRET = os.getenv("AUTH_SECRET", "")
TOKEN_TTL_SECONDS = 12 * 60 * 60
FRONTEND_DIR = Path(__file__).resolve().parent.parent / "chat-app"
UPLOAD_DIR = Path(__file__).resolve().parent / "uploads"
MAX_UPLOAD_BYTES = 20 * 1024 * 1024
bearer_scheme = HTTPBearer(auto_error=False)

if not AUTH_SECRET:
    if os.getenv("ENVIRONMENT", "").lower() == "production":
        raise RuntimeError("AUTH_SECRET must be configured before production startup.")
    AUTH_SECRET = secrets.token_urlsafe(48)
    logger.warning("AUTH_SECRET is not configured; sessions will expire when the server restarts.")
elif len(AUTH_SECRET.encode("utf-8")) < 32:
    raise RuntimeError("AUTH_SECRET must be at least 32 bytes.")

if bool(ADMIN_USERNAME) != bool(ADMIN_PASSWORD):
    raise RuntimeError("Set both ADMIN_USERNAME and ADMIN_PASSWORD to enable the admin account.")
if ADMIN_USERNAME and not re.fullmatch(r"[A-Za-z0-9_.-]{3,30}", ADMIN_USERNAME):
    raise RuntimeError("ADMIN_USERNAME must use 3-30 letters, numbers, dots, dashes or underscores.")
if ADMIN_PASSWORD and (len(ADMIN_PASSWORD) < 8 or len(ADMIN_PASSWORD.encode("utf-8")) > 72):
    raise RuntimeError("ADMIN_PASSWORD must be between 8 and 72 UTF-8 bytes.")


@asynccontextmanager
async def lifespan(_: FastAPI):
    try:
        await user_collection.create_index("username", unique=True)
        if ADMIN_USERNAME:
            admin = await user_collection.find_one({"username": ADMIN_USERNAME})
            if not admin:
                await user_collection.insert_one({
                    "username": ADMIN_USERNAME,
                    "password": hash_password(ADMIN_PASSWORD),
                    "created_at": datetime.datetime.now(datetime.timezone.utc),
                })
                logger.info("Created the configured admin account.")
    except PyMongoError:
        logger.exception("Could not initialize the database.")
        raise
    yield


app = FastAPI(title="Realtime Chat", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        origin.strip()
        for origin in os.getenv(
            "CORS_ORIGINS",
            "http://localhost:8000,http://127.0.0.1:8000,http://localhost:5500,http://127.0.0.1:5500",
        ).split(",")
        if origin.strip()
    ],
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "DELETE"],
    allow_headers=["Authorization", "Content-Type"],
)


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain_password: str, hashed_password: str) -> bool:
    try:
        return bcrypt.checkpw(plain_password.encode("utf-8"), hashed_password.encode("utf-8"))
    except (ValueError, TypeError):
        return False


def _encode_part(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def create_access_token(username: str) -> str:
    now = int(datetime.datetime.now(datetime.timezone.utc).timestamp())
    payload = _encode_part(json.dumps(
        {"sub": username, "iat": now, "exp": now + TOKEN_TTL_SECONDS},
        separators=(",", ":"),
    ).encode("utf-8"))
    signature = _encode_part(hmac.new(AUTH_SECRET.encode("utf-8"), payload.encode("ascii"), hashlib.sha256).digest())
    return f"{payload}.{signature}"


def decode_access_token(token: str) -> str:
    try:
        payload, supplied_signature = token.split(".", 1)
        expected_signature = _encode_part(
            hmac.new(AUTH_SECRET.encode("utf-8"), payload.encode("ascii"), hashlib.sha256).digest()
        )
        if not hmac.compare_digest(supplied_signature, expected_signature):
            raise ValueError("Invalid token signature")
        padded_payload = payload + "=" * (-len(payload) % 4)
        claims = json.loads(base64.urlsafe_b64decode(padded_payload).decode("utf-8"))
        if not isinstance(claims, dict):
            raise ValueError("Invalid token claims")
        if not isinstance(claims.get("sub"), str) or claims.get("exp", 0) <= int(
            datetime.datetime.now(datetime.timezone.utc).timestamp()
        ):
            raise ValueError("Expired or invalid token")
        return claims["sub"]
    except (ValueError, TypeError, KeyError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=401, detail="Phiên đăng nhập không hợp lệ hoặc đã hết hạn.") from exc


class AuthSchema(BaseModel):
    username: str = Field(min_length=3, max_length=30)
    password: str = Field(min_length=8, max_length=72)

    @field_validator("username")
    @classmethod
    def validate_username(cls, value: str) -> str:
        value = value.strip()
        if not re.fullmatch(r"[A-Za-z0-9_.-]{3,30}", value):
            raise ValueError("Tài khoản chỉ được chứa chữ, số, dấu chấm, gạch ngang và gạch dưới.")
        return value

    @field_validator("password")
    @classmethod
    def validate_password_length(cls, value: str) -> str:
        if len(value.encode("utf-8")) > 72:
            raise ValueError("Mật khẩu không được dài quá 72 byte.")
        return value


class UpdateProfileSchema(BaseModel):
    bio: str = Field(default="", max_length=160)
    avatar_url: str = Field(default="", max_length=2048)

    @field_validator("avatar_url")
    @classmethod
    def validate_avatar_url(cls, value: str) -> str:
        value = value.strip()
        if value and not value.startswith(("https://", "http://")):
            raise ValueError("Ảnh đại diện phải dùng địa chỉ HTTP hoặc HTTPS.")
        return value


class ResetPasswordSchema(BaseModel):
    new_password: str = Field(min_length=8, max_length=72)

    @field_validator("new_password")
    @classmethod
    def validate_password_length(cls, value: str) -> str:
        if len(value.encode("utf-8")) > 72:
            raise ValueError("Mật khẩu không được dài quá 72 byte.")
        return value


class WorldMemorySchema(BaseModel):
    title: str = Field(min_length=1, max_length=80)
    note: str = Field(default="", max_length=500)
    message_id: str | None = None

    @field_validator("title")
    @classmethod
    def validate_title(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Kỷ niệm cần có tiêu đề.")
        return value

    @field_validator("note")
    @classmethod
    def normalize_note(cls, value: str) -> str:
        return value.strip()


class GroupCreateSchema(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    members: list[str] = Field(min_length=1, max_length=49)

    @field_validator("name")
    @classmethod
    def normalize_name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Tên nhóm không được để trống.")
        return value

    @field_validator("members")
    @classmethod
    def validate_members(cls, values: list[str]) -> list[str]:
        for username in values:
            if not re.fullmatch(r"[A-Za-z0-9_.-]{3,30}", username):
                raise ValueError("Danh sách thành viên có tài khoản không hợp lệ.")
        return values


WORLD_STAGES = (
    (0, "Bến gặp gỡ", "Một thế giới nhỏ bắt đầu từ cuộc trò chuyện của hai bạn.", "🏝️"),
    (10, "Con đường chung", "Mỗi lần ghé thăm lại mở thêm một lối đi.", "🛤️"),
    (30, "Quán quen", "Hai bạn đã có một góc thân thuộc của riêng mình.", "☕"),
    (75, "Vườn kỷ niệm", "Những kỷ niệm được lưu lại đang làm khu vườn lớn lên.", "🌳"),
    (150, "Thành phố đôi", "Một thế giới đầy dấu ấn chung đã thành hình.", "🏙️"),
)


def build_world_progress(message_count: int, memory_count: int, game_count: int) -> dict:
    score = message_count + memory_count * 10 + game_count * 15
    stage_index = max(
        index for index, (threshold, _, _, _) in enumerate(WORLD_STAGES)
        if score >= threshold
    )
    threshold, name, description, landmark = WORLD_STAGES[stage_index]
    next_threshold = (
        WORLD_STAGES[stage_index + 1][0]
        if stage_index + 1 < len(WORLD_STAGES)
        else None
    )
    progress = 100 if next_threshold is None else round(
        (score - threshold) / (next_threshold - threshold) * 100
    )
    return {
        "level": stage_index + 1,
        "name": name,
        "description": description,
        "landmark": landmark,
        "score": score,
        "next_threshold": next_threshold,
        "progress": progress,
    }


async def get_current_username(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)],
) -> str:
    if not credentials:
        raise HTTPException(status_code=401, detail="Vui lòng đăng nhập.")
    username = decode_access_token(credentials.credentials)
    try:
        if not await user_collection.find_one({"username": username}, {"_id": 1}):
            raise HTTPException(status_code=401, detail="Tài khoản không còn tồn tại.")
    except PyMongoError as exc:
        raise HTTPException(status_code=503, detail="Không thể kết nối cơ sở dữ liệu.") from exc
    return username


async def require_admin(username: Annotated[str, Depends(get_current_username)]) -> str:
    if not ADMIN_USERNAME or not ADMIN_PASSWORD:
        raise HTTPException(status_code=503, detail="Admin chưa được cấu hình trên máy chủ.")
    if not hmac.compare_digest(username, ADMIN_USERNAME):
        raise HTTPException(status_code=403, detail="Bạn không có quyền quản trị.")
    return username


def private_room_id(username_a: str, username_b: str) -> str:
    first, second = sorted((username_a, username_b))
    return f"chat_{first}_{second}"


async def is_room_member(room: str, username: str) -> bool:
    if room.startswith("group_"):
        try:
            return await database["groups"].find_one(
                {"_id": room, "members": username}, {"_id": 1}
            ) is not None
        except PyMongoError as exc:
            raise HTTPException(status_code=503, detail="Không thể xác thực thành viên nhóm.") from exc
    try:
        users = await user_collection.find(
            {"username": {"$ne": username}}, {"username": 1, "_id": 0}
        ).to_list(length=5000)
    except PyMongoError as exc:
        raise HTTPException(status_code=503, detail="Không thể kết nối cơ sở dữ liệu.") from exc
    return any(private_room_id(username, user["username"]) == room for user in users)


@app.get("/api/health")
async def health():
    try:
        await user_collection.database.command("ping")
    except PyMongoError as exc:
        raise HTTPException(status_code=503, detail="Không thể kết nối cơ sở dữ liệu.") from exc
    return {"status": "ok"}


@app.post("/api/register")
async def register(data: AuthSchema):
    if ADMIN_USERNAME and hmac.compare_digest(data.username, ADMIN_USERNAME):
        raise HTTPException(status_code=409, detail="Tài khoản quản trị được tạo từ cấu hình máy chủ.")
    try:
        await user_collection.insert_one({
            "username": data.username,
            "password": hash_password(data.password),
            "created_at": datetime.datetime.now(datetime.timezone.utc),
            "bio": "",
            "avatar_url": "",
        })
    except DuplicateKeyError as exc:
        raise HTTPException(status_code=409, detail="Tài khoản đã tồn tại.") from exc
    except PyMongoError as exc:
        raise HTTPException(status_code=503, detail="Không thể lưu tài khoản.") from exc
    return {"status": "ok", "message": "Đăng ký thành công!"}


@app.post("/api/login")
async def login(data: AuthSchema):
    try:
        user = await user_collection.find_one({"username": data.username})
    except PyMongoError as exc:
        raise HTTPException(status_code=503, detail="Không thể kết nối cơ sở dữ liệu.") from exc
    if not user or not verify_password(data.password, user.get("password", "")):
        raise HTTPException(status_code=401, detail="Sai tài khoản hoặc mật khẩu.")
    return {
        "status": "ok",
        "username": data.username,
        "is_admin": bool(ADMIN_USERNAME and hmac.compare_digest(data.username, ADMIN_USERNAME)),
        "access_token": create_access_token(data.username),
        "token_type": "bearer",
    }


@app.get("/api/me")
async def get_me(username: Annotated[str, Depends(get_current_username)]):
    return {
        "username": username,
        "is_admin": bool(ADMIN_USERNAME and hmac.compare_digest(username, ADMIN_USERNAME)),
    }


@app.get("/api/users")
async def get_all_users(_: Annotated[str, Depends(get_current_username)]):
    try:
        cursor = user_collection.find({}, {"username": 1, "_id": 0}).sort("username", 1)
        users = await cursor.to_list(length=5000)
    except PyMongoError as exc:
        raise HTTPException(status_code=503, detail="Không thể tải danh sách tài khoản.") from exc
    return [user["username"] for user in users]


@app.get("/api/messages/{room}")
async def get_messages(room: str, username: Annotated[str, Depends(get_current_username)]):
    if not await is_room_member(room, username):
        raise HTTPException(status_code=403, detail="Bạn không thuộc cuộc trò chuyện này.")
    try:
        cursor = message_collection.find({"room": room}).sort("_id", -1).limit(50)
        messages = await cursor.to_list(length=50)
    except PyMongoError as exc:
        raise HTTPException(status_code=503, detail="Không thể tải tin nhắn.") from exc
    for message in messages:
        message["_id"] = str(message["_id"])
    messages.reverse()
    return messages


async def require_world_room(other_username: str, username: str) -> str:
    if other_username == username:
        raise HTTPException(status_code=400, detail="Thế giới chung cần có hai tài khoản khác nhau.")
    room = private_room_id(username, other_username)
    if not await is_room_member(room, username):
        raise HTTPException(status_code=404, detail="Không tìm thấy cuộc trò chuyện này.")
    return room


@app.get("/api/world/{other_username}")
async def get_private_world(
    other_username: str,
    username: Annotated[str, Depends(get_current_username)],
):
    room = await require_world_room(other_username, username)
    try:
        message_count = await message_collection.count_documents({"room": room})
        memory_count = await world_memory_collection.count_documents({"room": room})
        game_count = await world_game_collection.count_documents({"room": room})
        cursor = (
            world_memory_collection.find({"room": room})
            .sort("created_at", -1)
            .limit(50)
        )
        memories = await cursor.to_list(length=50)
    except PyMongoError as exc:
        raise HTTPException(status_code=503, detail="Không thể tải thế giới chung.") from exc

    for memory in memories:
        memory["id"] = str(memory.pop("_id"))
        if isinstance(memory.get("created_at"), datetime.datetime):
            memory["created_at"] = memory["created_at"].isoformat()
    return {
        "world": build_world_progress(message_count, memory_count, game_count),
        "stats": {
            "messages": message_count,
            "memories": memory_count,
            "games": game_count,
        },
        "memories": memories,
        "memories_truncated": memory_count > len(memories),
    }


@app.post("/api/world/{other_username}/memories", status_code=201)
async def save_world_memory(
    other_username: str,
    data: WorldMemorySchema,
    username: Annotated[str, Depends(get_current_username)],
):
    room = await require_world_room(other_username, username)
    source_excerpt = ""
    if data.message_id is not None:
        if not ObjectId.is_valid(data.message_id):
            raise HTTPException(status_code=400, detail="Tin nhắn được chọn không hợp lệ.")
        try:
            source_message = await message_collection.find_one({
                "_id": ObjectId(data.message_id),
                "room": room,
                "is_deleted": {"$ne": True},
            })
        except PyMongoError as exc:
            raise HTTPException(status_code=503, detail="Không thể lưu kỷ niệm.") from exc
        if not source_message:
            raise HTTPException(status_code=404, detail="Tin nhắn không còn khả dụng để lưu.")
        source_excerpt = source_message.get("content", "")[:240]

    memory = {
        "room": room,
        "created_by": username,
        "title": data.title,
        "note": data.note,
        "source_message_id": data.message_id,
        "source_excerpt": source_excerpt,
        "created_at": datetime.datetime.now(datetime.timezone.utc),
    }
    try:
        result = await world_memory_collection.insert_one(memory)
    except PyMongoError as exc:
        raise HTTPException(status_code=503, detail="Không thể lưu kỷ niệm.") from exc
    memory["id"] = str(result.inserted_id)
    memory.pop("_id", None)
    memory["created_at"] = memory["created_at"].isoformat()
    return {"memory": memory}


@app.delete("/api/world/{other_username}/memories/{memory_id}")
async def delete_world_memory(
    other_username: str,
    memory_id: str,
    username: Annotated[str, Depends(get_current_username)],
):
    room = await require_world_room(other_username, username)
    if not ObjectId.is_valid(memory_id):
        raise HTTPException(status_code=400, detail="Mã kỷ niệm không hợp lệ.")
    try:
        result = await world_memory_collection.delete_one({
            "_id": ObjectId(memory_id),
            "room": room,
            "created_by": username,
        })
    except PyMongoError as exc:
        raise HTTPException(status_code=503, detail="Không thể xóa kỷ niệm.") from exc
    if not result.deleted_count:
        raise HTTPException(status_code=404, detail="Không tìm thấy kỷ niệm của bạn.")
    return {"status": "ok"}


@app.get("/api/profile/{username}")
async def get_profile(
    username: str,
    _: Annotated[str, Depends(get_current_username)],
):
    try:
        user = await user_collection.find_one(
            {"username": username}, {"password": 0}
        )
    except PyMongoError as exc:
        raise HTTPException(status_code=503, detail="Không thể tải hồ sơ.") from exc
    if not user:
        raise HTTPException(status_code=404, detail="Không tìm thấy người dùng.")
    user["_id"] = str(user["_id"])
    if isinstance(user.get("created_at"), datetime.datetime):
        user["created_at"] = user["created_at"].strftime("%Y-%m-%d %H:%M")
    return user


@app.put("/api/profile/{username}")
async def update_profile(
    username: str,
    data: UpdateProfileSchema,
    current_username: Annotated[str, Depends(get_current_username)],
):
    if username != current_username:
        raise HTTPException(status_code=403, detail="Bạn chỉ có thể cập nhật hồ sơ của mình.")
    try:
        await user_collection.update_one(
            {"username": current_username},
            {"$set": {"bio": data.bio.strip(), "avatar_url": data.avatar_url}},
        )
    except PyMongoError as exc:
        raise HTTPException(status_code=503, detail="Không thể cập nhật hồ sơ.") from exc
    return {"status": "ok", "message": "Cập nhật trang cá nhân thành công!"}


@app.get("/api/admin/users")
async def get_all_users_admin(_: Annotated[str, Depends(require_admin)]):
    try:
        users = await user_collection.find({}, {"password": 0}).sort("created_at", -1).to_list(length=1000)
    except PyMongoError as exc:
        raise HTTPException(status_code=503, detail="Không thể tải danh sách tài khoản.") from exc
    for user in users:
        user["_id"] = str(user["_id"])
        if isinstance(user.get("created_at"), datetime.datetime):
            user["created_at"] = user["created_at"].strftime("%Y-%m-%d %H:%M")
    return users


@app.delete("/api/admin/users/{user_id}")
async def delete_user(user_id: str, _: Annotated[str, Depends(require_admin)]):
    if not ObjectId.is_valid(user_id):
        raise HTTPException(status_code=400, detail="Mã tài khoản không hợp lệ.")
    try:
        result = await user_collection.delete_one({
            "_id": ObjectId(user_id),
            "username": {"$ne": ADMIN_USERNAME},
        })
    except PyMongoError as exc:
        raise HTTPException(status_code=503, detail="Không thể xóa tài khoản.") from exc
    if not result.deleted_count:
        raise HTTPException(status_code=404, detail="Không tìm thấy tài khoản hoặc không thể xóa admin.")
    return {"status": "ok", "message": "Đã xóa tài khoản thành công."}


@app.put("/api/admin/users/{user_id}/reset-password")
async def reset_user_password(
    user_id: str,
    data: ResetPasswordSchema,
    _: Annotated[str, Depends(require_admin)],
):
    if not ObjectId.is_valid(user_id):
        raise HTTPException(status_code=400, detail="Mã tài khoản không hợp lệ.")
    try:
        result = await user_collection.update_one(
            {"_id": ObjectId(user_id)},
            {"$set": {"password": hash_password(data.new_password)}},
        )
    except PyMongoError as exc:
        raise HTTPException(status_code=503, detail="Không thể đổi mật khẩu.") from exc
    if not result.matched_count:
        raise HTTPException(status_code=404, detail="Không tìm thấy tài khoản.")
    return {"status": "ok", "message": "Đã đổi mật khẩu thành công."}


class ConnectionManager:
    def __init__(self):
        self.rooms: dict[str, dict[str, set[WebSocket]]] = {}
        self._lock = asyncio.Lock()

    async def connect(self, room: str, username: str, websocket: WebSocket):
        await websocket.accept(subprotocol="chat")
        async with self._lock:
            self.rooms.setdefault(room, {}).setdefault(username, set()).add(websocket)

    async def disconnect(self, room: str, username: str, websocket: WebSocket) -> bool:
        async with self._lock:
            room_users = self.rooms.get(room)
            if not room_users:
                return False
            connections = room_users.get(username)
            if not connections:
                return False
            connections.discard(websocket)
            if connections:
                return False
            del room_users[username]
            if not room_users:
                del self.rooms[room]
            return True

    async def broadcast_to_room(self, room: str, message_data: dict):
        async with self._lock:
            connections = [
                (username, connection)
                for username, user_connections in self.rooms.get(room, {}).items()
                for connection in user_connections
            ]
        for username, connection in connections:
            try:
                await connection.send_json(message_data)
            except (WebSocketDisconnect, WebSocketDisconnected, RuntimeError):
                await self.disconnect(room, username, connection)

    async def online_users(self, room: str) -> list[str]:
        async with self._lock:
            return list(self.rooms.get(room, {}))

    async def send_to_user_in_room(self, room: str, username: str, message_data: dict) -> bool:
        async with self._lock:
            connections = list(self.rooms.get(room, {}).get(username, set()))
        if not connections:
            return False
        sent = False
        for connection in connections:
            try:
                await connection.send_json(message_data)
                sent = True
            except (WebSocketDisconnect, WebSocketDisconnected, RuntimeError):
                await self.disconnect(room, username, connection)
        return sent


manager = ConnectionManager()
MAX_CALL_PARTICIPANTS = 4


class WebRTCCallManager:
    def __init__(self):
        self.sessions: dict[tuple[str, str], dict] = {}
        self._lock = asyncio.Lock()

    async def start(self, room: str, call_id: str, initiator: str) -> bool:
        async with self._lock:
            key = (room, call_id)
            if key in self.sessions:
                return False
            self.sessions[key] = {"initiator": initiator, "participants": {initiator}}
            return True

    async def exists(self, room: str, call_id: str) -> bool:
        async with self._lock:
            return (room, call_id) in self.sessions

    async def join(self, room: str, call_id: str, username: str) -> tuple[bool, list[str]]:
        async with self._lock:
            session = self.sessions.get((room, call_id))
            if not session:
                return False, []
            participants = session["participants"]
            if username not in participants and len(participants) >= MAX_CALL_PARTICIPANTS:
                return False, sorted(participants)
            participants.add(username)
            return True, sorted(participants)

    async def can_signal(self, room: str, call_id: str, sender: str, target: str) -> bool:
        async with self._lock:
            session = self.sessions.get((room, call_id))
            return bool(
                session
                and sender in session["participants"]
                and target in session["participants"]
                and sender != target
            )

    async def leave(self, room: str, call_id: str, username: str) -> tuple[bool, list[str]]:
        async with self._lock:
            key = (room, call_id)
            session = self.sessions.get(key)
            if not session or username not in session["participants"]:
                return False, []
            session["participants"].remove(username)
            participants = sorted(session["participants"])
            if not participants:
                del self.sessions[key]
            return True, participants

    async def disconnect(self, room: str, username: str) -> list[tuple[str, list[str]]]:
        updates = []
        async with self._lock:
            for key, session in list(self.sessions.items()):
                if key[0] != room or username not in session["participants"]:
                    continue
                session["participants"].remove(username)
                participants = sorted(session["participants"])
                updates.append((key[1], participants))
                if not participants:
                    del self.sessions[key]
        return updates


call_manager = WebRTCCallManager()


class TetrisMatchManager:
    def __init__(self):
        self.waiting: list[tuple[str, WebSocket]] = []
        self.matches: dict[str, dict] = {}
        self.player_matches: dict[str, str] = {}
        self._lock = asyncio.Lock()

    async def join(self, username: str, websocket: WebSocket):
        async with self._lock:
            if username in self.player_matches or any(name == username for name, _ in self.waiting):
                duplicate = True
                opponent = None
                game_id = None
                waiting_players = []
            else:
                duplicate = False
                opponent_index = next(
                    (index for index, (name, _) in enumerate(self.waiting) if name != username),
                    None,
                )
                if opponent_index is None:
                    self.waiting.append((username, websocket))
                    waiting_players = list(self.waiting)
                    opponent = None
                    game_id = None
                else:
                    opponent, opponent_socket = self.waiting.pop(opponent_index)
                    game_id = secrets.token_urlsafe(12)
                    players = {opponent: opponent_socket, username: websocket}
                    self.matches[game_id] = {"players": players, "scores": {opponent: 0, username: 0}}
                    self.player_matches[opponent] = game_id
                    self.player_matches[username] = game_id
                    waiting_players = list(self.waiting)

        if duplicate:
            await websocket.send_json({"type": "error", "message": "Tài khoản này đã vào hàng chờ hoặc đang chơi."})
            await websocket.close(code=4409, reason="Tài khoản đã tham gia trò chơi.")
            return
        if opponent is None:
            await websocket.send_json({"type": "waiting", "players_waiting": len(waiting_players)})
            await self._broadcast_waiting_count(waiting_players)
            return

        await asyncio.gather(
            websocket.send_json({
                "type": "matched",
                "game_id": game_id,
                "opponent": opponent,
                "your_turn": False,
            }),
            next(
                player_socket.send_json({
                    "type": "matched",
                    "game_id": game_id,
                    "opponent": username,
                    "your_turn": True,
                })
                for player_name, player_socket in self.matches[game_id]["players"].items()
                if player_name == opponent
            ),
        )
        await self._broadcast_waiting_count(waiting_players)

    async def update_score(self, username: str, websocket: WebSocket, score: int):
        if not isinstance(score, int) or isinstance(score, bool) or not 0 <= score <= 10_000_000:
            return
        async with self._lock:
            game_id = self.player_matches.get(username)
            match = self.matches.get(game_id)
            if not match or match["players"].get(username) is not websocket:
                return
            match["scores"][username] = max(score, match["scores"][username])
            opponent = next(name for name in match["players"] if name != username)
            opponent_socket = match["players"][opponent]
        await opponent_socket.send_json({"type": "opponent_score", "score": match["scores"][username]})

    async def finish(self, username: str, websocket: WebSocket, score: int):
        if not isinstance(score, int) or isinstance(score, bool) or not 0 <= score <= 10_000_000:
            await websocket.send_json({"type": "error", "message": "Điểm trò chơi không hợp lệ."})
            return
        async with self._lock:
            game_id = self.player_matches.get(username)
            match = self.matches.get(game_id)
            if not match or match["players"].get(username) is not websocket:
                return
            match["scores"][username] = max(score, match["scores"][username])
            opponent = next(name for name in match["players"] if name != username)
            opponent_socket = match["players"][opponent]
            winner_score = match["scores"][opponent]
            self.matches.pop(game_id)
            for player in match["players"]:
                self.player_matches.pop(player, None)
            waiting_players = list(self.waiting)
        await asyncio.gather(
            websocket.send_json({"type": "result", "result": "lose", "opponent_score": winner_score}),
            opponent_socket.send_json({"type": "result", "result": "win", "opponent_score": match["scores"][username]}),
            return_exceptions=True,
        )
        for player_socket in match["players"].values():
            try:
                await player_socket.close(code=4000, reason="Ván đấu đã kết thúc.")
            except (RuntimeError, WebSocketDisconnect, WebSocketDisconnected):
                pass
        await self._broadcast_waiting_count(waiting_players)

    async def leave(self, username: str, websocket: WebSocket):
        async with self._lock:
            waiting_index = next(
                (
                    index for index, (name, waiting_socket) in enumerate(self.waiting)
                    if name == username and waiting_socket is websocket
                ),
                None,
            )
            if waiting_index is not None:
                self.waiting.pop(waiting_index)
                waiting_players = list(self.waiting)
                disconnected_match = None
            else:
                waiting_players = list(self.waiting)
                game_id = self.player_matches.get(username)
                match = self.matches.get(game_id)
                if not match or match["players"].get(username) is not websocket:
                    disconnected_match = None
                else:
                    opponent = next(name for name in match["players"] if name != username)
                    disconnected_match = (match["players"][opponent], match["scores"][opponent])
                    self.matches.pop(game_id)
                    for player in match["players"]:
                        self.player_matches.pop(player, None)

        if disconnected_match:
            opponent_socket, opponent_score = disconnected_match
            try:
                await opponent_socket.send_json({
                    "type": "result",
                    "result": "win",
                    "reason": "opponent_disconnected",
                    "opponent_score": opponent_score,
                })
                await opponent_socket.close(code=4001, reason="Đối thủ đã rời trận.")
            except (RuntimeError, WebSocketDisconnect, WebSocketDisconnected):
                pass
        await self._broadcast_waiting_count(waiting_players)

    async def _broadcast_waiting_count(self, players: list[tuple[str, WebSocket]]):
        for _, waiting_socket in players:
            try:
                await waiting_socket.send_json({"type": "waiting", "players_waiting": len(players)})
            except (RuntimeError, WebSocketDisconnect, WebSocketDisconnected):
                logger.debug("Could not update the Tetris waiting queue.")


class QuickGameMatchManager:
    game_names = {"gomoku", "rps", "duel"}

    def __init__(self):
        self.waiting: dict[str, list[tuple[str, WebSocket]]] = {
            name: [] for name in self.game_names
        }
        self.matches: dict[str, dict] = {}
        self.player_matches: dict[tuple[str, str], str] = {}
        self._lock = asyncio.Lock()

    async def join(self, game: str, username: str, websocket: WebSocket):
        async with self._lock:
            queue = self.waiting[game]
            if any(name == username for name, _ in queue) or (game, username) in self.player_matches:
                opponent = None
                game_id = None
                waiting_players = []
                duplicate = True
            else:
                duplicate = False
                if not queue:
                    queue.append((username, websocket))
                    waiting_players = list(queue)
                    opponent = None
                    game_id = None
                else:
                    opponent, opponent_socket = queue.pop(0)
                    game_id = secrets.token_urlsafe(12)
                    players = [opponent, username]
                    match = {
                        "game": game,
                        "players": {opponent: opponent_socket, username: websocket},
                        "turn": opponent,
                        "wins": {opponent: 0, username: 0},
                        "round": 1,
                    }
                    if game == "gomoku":
                        match["board"] = [[None] * 15 for _ in range(15)]
                    elif game == "rps":
                        match["choices"] = {}
                    else:
                        match["ready"] = set()
                        match["signal"] = False
                        match["duel_task"] = None
                    self.matches[game_id] = match
                    for player in players:
                        self.player_matches[(game, player)] = game_id
                    waiting_players = list(queue)

        if duplicate:
            await self._send(websocket, {"type": "error", "message": "Tài khoản này đã vào hàng chờ hoặc đang chơi trò này."})
            await self._close(websocket, 4409, "Tài khoản đã tham gia trò chơi.")
            return
        if opponent is None:
            await self._send(websocket, {"type": "waiting", "players_waiting": len(waiting_players)})
            await self._broadcast_waiting(game, waiting_players)
            return

        for player, player_socket in self.matches[game_id]["players"].items():
            event = {
                "type": "matched",
                "game_id": game_id,
                "opponent": username if player == opponent else opponent,
                "your_turn": player == opponent,
            }
            if game == "gomoku":
                event["mark"] = "X" if player == opponent else "O"
            await self._send(player_socket, event)
        if game == "rps":
            await self._broadcast_match(game_id, {"type": "round_started", "round": 1})
        elif game == "duel":
            await self._broadcast_match(game_id, {"type": "ready_required", "round": 1})
        await self._broadcast_waiting(game, waiting_players)

    async def handle(self, game: str, username: str, websocket: WebSocket, event: dict):
        game_id = self.player_matches.get((game, username))
        if game_id is None:
            return
        if game == "gomoku" and event.get("type") == "move":
            await self._move_gomoku(game_id, username, websocket, event)
        elif game == "rps" and event.get("type") == "choice":
            await self._choose_rps(game_id, username, websocket, event.get("choice"))
        elif game == "duel":
            if event.get("type") == "ready":
                await self._ready_duel(game_id, username, websocket)
            elif event.get("type") == "react":
                await self._react_duel(game_id, username, websocket)
            else:
                await self._send(websocket, {"type": "error", "message": "Sự kiện trò chơi không hợp lệ."})
        else:
            await self._send(websocket, {"type": "error", "message": "Sự kiện trò chơi không hợp lệ."})

    async def _move_gomoku(self, game_id: str, username: str, websocket: WebSocket, event: dict):
        row, column = event.get("row"), event.get("column")
        async with self._lock:
            match = self.matches.get(game_id)
            if not match or match["players"].get(username) is not websocket:
                return
            if username != match["turn"]:
                error = "Chưa đến lượt của bạn."
                updates = []
                ended = False
            elif (
                not isinstance(row, int) or isinstance(row, bool) or not 0 <= row < 15
                or not isinstance(column, int) or isinstance(column, bool) or not 0 <= column < 15
            ):
                error = "Nước đi không hợp lệ."
                updates = []
                ended = False
            elif match["board"][row][column] is not None:
                error = "Ô này đã có quân."
                updates = []
                ended = False
            else:
                error = ""
                mark = "X" if username == next(iter(match["players"])) else "O"
                match["board"][row][column] = mark
                winner = self._gomoku_winner(match["board"], row, column)
                draw = not winner and all(cell is not None for board_row in match["board"] for cell in board_row)
                move_event = {"type": "move", "row": row, "column": column, "mark": mark, "username": username}
                if winner or draw:
                    updates = [(player, move_event) for player in match["players"]]
                    result = self._remove_match(game_id, match)
                    updates.extend(
                        (player, {
                            "type": "result",
                            "result": "draw" if draw else ("win" if player == username else "lose"),
                            "reason": "draw" if draw else "five_in_a_row",
                        })
                        for player in match["players"]
                    )
                    ended = True
                else:
                    match["turn"] = next(player for player in match["players"] if player != username)
                    updates = [(player, move_event) for player in match["players"]]
                    updates.extend(
                        (player, {"type": "turn", "your_turn": player == match["turn"]})
                        for player in match["players"]
                    )
                    ended = False
        if error:
            await self._send(websocket, {"type": "error", "message": error})
            return
        for player, update in updates:
            await self._send(result["players"][player] if ended else match["players"][player], update)
        if ended:
            await self._close_match(result, 4000, "Ván cờ đã kết thúc.")

    @staticmethod
    def _gomoku_winner(board: list[list[str | None]], row: int, column: int) -> bool:
        mark = board[row][column]
        for row_step, column_step in ((0, 1), (1, 0), (1, 1), (1, -1)):
            count = 1
            for direction in (-1, 1):
                next_row, next_column = row + row_step * direction, column + column_step * direction
                while (
                    0 <= next_row < 15 and 0 <= next_column < 15
                    and board[next_row][next_column] == mark
                ):
                    count += 1
                    next_row += row_step * direction
                    next_column += column_step * direction
            if count >= 5:
                return True
        return False

    async def _choose_rps(self, game_id: str, username: str, websocket: WebSocket, choice: str):
        if choice not in {"rock", "paper", "scissors"}:
            await self._send(websocket, {"type": "error", "message": "Nước đi không hợp lệ."})
            return
        async with self._lock:
            match = self.matches.get(game_id)
            if not match or match["players"].get(username) is not websocket:
                return
            if username in match["choices"]:
                return
            match["choices"][username] = choice
            if len(match["choices"]) < 2:
                updates = [(username, websocket, {"type": "waiting_choice"})]
                result = None
            else:
                first, second = match["players"]
                choices = dict(match["choices"])
                if choices[first] == choices[second]:
                    winner = None
                elif (choices[first], choices[second]) in {
                    ("rock", "scissors"), ("scissors", "paper"), ("paper", "rock"),
                }:
                    winner = first
                else:
                    winner = second
                if winner:
                    match["wins"][winner] += 1
                updates = [
                    (
                        player,
                        match["players"][player],
                        {
                            "type": "round_result",
                            "round": match["round"],
                            "your_choice": choices[player],
                            "opponent_choice": choices[next(name for name in match["players"] if name != player)],
                            "round_winner": winner,
                            "your_round_wins": match["wins"][player],
                            "opponent_round_wins": match["wins"][next(name for name in match["players"] if name != player)],
                        },
                    )
                    for player in match["players"]
                ]
                if any(round_wins == 2 for round_wins in match["wins"].values()):
                    finished = self._remove_match(game_id, match)
                    updates.extend(
                        (
                            player,
                            finished["players"][player],
                            {
                                "type": "result",
                                "result": "win" if match["wins"][player] == 2 else "lose",
                                "reason": "best_of_three",
                            },
                        )
                        for player in match["players"]
                    )
                    result = finished
                else:
                    match["choices"] = {}
                    match["round"] += 1
                    updates.extend(
                        (player, match["players"][player], {"type": "round_started", "round": match["round"]})
                        for player in match["players"]
                    )
                    result = None
        for _, target, update in updates:
            await self._send(target, update)
        if result:
            await self._close_match(result, 4000, "Ván đấu đã kết thúc.")

    async def _ready_duel(self, game_id: str, username: str, websocket: WebSocket):
        async with self._lock:
            match = self.matches.get(game_id)
            if not match or match["players"].get(username) is not websocket:
                return
            match["ready"].add(username)
            players = list(match["players"].items())
            ready_count = len(match["ready"])
            if ready_count == 2:
                if match["duel_task"] is None or match["duel_task"].done():
                    match["signal"] = False
                    match["duel_task"] = asyncio.create_task(self._start_duel_round(game_id))
                updates = [(player_socket, {"type": "countdown", "round": match["round"]}) for _, player_socket in players]
            else:
                updates = [(websocket, {"type": "waiting_ready"})]
        for target, update in updates:
            await self._send(target, update)

    async def _start_duel_round(self, game_id: str):
        await asyncio.sleep(secrets.randbelow(21) / 10 + 1.5)
        async with self._lock:
            match = self.matches.get(game_id)
            if not match or len(match["ready"]) != 2:
                return
            match["signal"] = True
            players = list(match["players"].values())
            round_number = match["round"]
        await asyncio.gather(*(
            self._send(player_socket, {"type": "signal", "round": round_number})
            for player_socket in players
        ))

    async def _react_duel(self, game_id: str, username: str, websocket: WebSocket):
        async with self._lock:
            match = self.matches.get(game_id)
            if not match or match["players"].get(username) is not websocket:
                return
            if username not in match["ready"]:
                update = {"type": "error", "message": "Nhấn Sẵn sàng trước khi phản xạ."}
                updates = [(websocket, update)]
                finished = None
            elif not match["signal"]:
                winner = next(player for player in match["players"] if player != username)
                updates, finished = self._resolve_duel_round(game_id, match, winner, "false_start")
            else:
                updates, finished = self._resolve_duel_round(game_id, match, username, "reaction")
        for target, update in updates:
            await self._send(target, update)
        if finished:
            await self._close_match(finished, 4000, "Trận đấu đã kết thúc.")

    def _resolve_duel_round(self, game_id: str, match: dict, winner: str, reason: str):
        match["signal"] = False
        match["wins"][winner] += 1
        updates = [
            (
                player_socket,
                {
                    "type": "round_result",
                    "round": match["round"],
                    "winner": winner,
                    "reason": reason,
                    "your_round_wins": match["wins"][player],
                    "opponent_round_wins": match["wins"][next(name for name in match["players"] if name != player)],
                },
            )
            for player, player_socket in match["players"].items()
        ]
        if match["wins"][winner] == 2:
            finished = self._remove_match(game_id, match)
            updates.extend(
                (
                    finished["players"][player],
                    {"type": "result", "result": "win" if player == winner else "lose", "reason": reason},
                )
                for player in match["players"]
            )
            return updates, finished
        match["round"] += 1
        match["ready"].clear()
        updates.extend(
            (player_socket, {"type": "ready_required", "round": match["round"]})
            for player_socket in match["players"].values()
        )
        return updates, None

    async def leave(self, game: str, username: str, websocket: WebSocket):
        async with self._lock:
            queue = self.waiting[game]
            queue[:] = [
                (name, waiting_socket)
                for name, waiting_socket in queue
                if not (name == username and waiting_socket is websocket)
            ]
            game_id = self.player_matches.get((game, username))
            match = self.matches.get(game_id)
            if not match or match["players"].get(username) is not websocket:
                finished = None
                waiting_players = list(queue)
            else:
                opponent = next(player for player in match["players"] if player != username)
                finished = self._remove_match(game_id, match)
                task = finished.get("duel_task")
                if task and not task.done():
                    task.cancel()
                waiting_players = list(queue)
        if finished:
            await self._send(
                finished["players"][opponent],
                {"type": "result", "result": "win", "reason": "opponent_disconnected"},
            )
            await self._close(finished["players"][opponent], 4001, "Đối thủ đã rời trận.")
        await self._broadcast_waiting(game, waiting_players)

    def _remove_match(self, game_id: str, match: dict) -> dict:
        self.matches.pop(game_id, None)
        for player in match["players"]:
            self.player_matches.pop((match["game"], player), None)
        return match

    async def _broadcast_match(self, game_id: str, event: dict):
        match = self.matches.get(game_id)
        if match:
            await asyncio.gather(*(
                self._send(player_socket, event)
                for player_socket in match["players"].values()
            ))

    async def _broadcast_waiting(self, game: str, players: list[tuple[str, WebSocket]]):
        await asyncio.gather(*(
            self._send(player_socket, {"type": "waiting", "players_waiting": len(players)})
            for _, player_socket in players
        ))

    async def _close_match(self, match: dict, code: int, reason: str):
        await asyncio.gather(*(
            self._close(player_socket, code, reason)
            for player_socket in match["players"].values()
        ))

    @staticmethod
    async def _send(websocket: WebSocket, event: dict):
        try:
            await websocket.send_json(event)
        except (RuntimeError, WebSocketDisconnect, WebSocketDisconnected):
            logger.debug("Could not send quick-game event.")

    @staticmethod
    async def _close(websocket: WebSocket, code: int, reason: str):
        try:
            await websocket.close(code=code, reason=reason)
        except (RuntimeError, WebSocketDisconnect, WebSocketDisconnected):
            logger.debug("Could not close quick-game connection.")


game_manager = TetrisMatchManager()
quick_game_manager = QuickGameMatchManager()


async def record_world_game(game_id: str, players: tuple[str, ...]):
    if len(players) != 2 or players[0] == players[1]:
        logger.error("Skipped world-game recording for invalid match %s.", game_id)
        return
    participants = tuple(sorted(players))
    try:
        await world_game_collection.insert_one({
            "_id": game_id,
            "room": private_room_id(*participants),
            "players": list(participants),
            "completed_at": datetime.datetime.now(datetime.timezone.utc),
        })
    except DuplicateKeyError:
        return
    except PyMongoError:
        logger.exception("Could not record completed quick game %s.", game_id)


@app.websocket("/ws/tetris")
async def tetris_websocket_endpoint(websocket: WebSocket):
    protocols = [
        protocol.strip()
        for protocol in websocket.headers.get("sec-websocket-protocol", "").split(",")
    ]
    token = next(
        (protocol.removeprefix("bearer.") for protocol in protocols if protocol.startswith("bearer.")),
        "",
    )
    try:
        username = decode_access_token(token)
    except HTTPException:
        await websocket.close(code=4401, reason="Vui lòng đăng nhập lại.")
        return
    try:
        if not await user_collection.find_one({"username": username}, {"_id": 1}):
            await websocket.close(code=4401, reason="Tài khoản không còn tồn tại.")
            return
    except PyMongoError:
        logger.exception("Could not validate a Tetris player.")
        await websocket.close(code=1011, reason="Không thể kết nối cơ sở dữ liệu.")
        return

    await websocket.accept(subprotocol="tetris")
    completed_match = None
    try:
        await game_manager.join(username, websocket)
        while True:
            event = await websocket.receive_json()
            if completed_match is None:
                game_id = game_manager.player_matches.get(username)
                match = game_manager.matches.get(game_id)
                if match:
                    completed_match = (game_id, tuple(match["players"]))
            if not isinstance(event, dict):
                await websocket.send_json({"type": "error", "message": "Dữ liệu trò chơi không hợp lệ."})
            elif event.get("type") == "score":
                await game_manager.update_score(username, websocket, event.get("score"))
            elif event.get("type") == "game_over":
                await game_manager.finish(username, websocket, event.get("score"))
            else:
                await websocket.send_json({"type": "error", "message": "Sự kiện trò chơi không được hỗ trợ."})
            if completed_match and completed_match[0] not in game_manager.matches:
                await record_world_game(*completed_match)
                completed_match = None
    except (WebSocketDisconnect, WebSocketDisconnected):
        pass
    except PyMongoError:
        logger.exception("Tetris WebSocket operation failed.")
        try:
            await websocket.close(code=1011, reason="Lỗi xử lý trò chơi.")
        except RuntimeError:
            pass
    finally:
        if completed_match is None:
            game_id = game_manager.player_matches.get(username)
            match = game_manager.matches.get(game_id)
            if match:
                completed_match = (game_id, tuple(match["players"]))
        await game_manager.leave(username, websocket)
        if completed_match and completed_match[0] not in game_manager.matches:
            await record_world_game(*completed_match)


@app.websocket("/ws/games/{game}")
async def quick_game_websocket_endpoint(websocket: WebSocket, game: str):
    if game not in quick_game_manager.game_names:
        await websocket.close(code=4404, reason="Trò chơi không tồn tại.")
        return
    protocols = [
        protocol.strip()
        for protocol in websocket.headers.get("sec-websocket-protocol", "").split(",")
    ]
    token = next(
        (protocol.removeprefix("bearer.") for protocol in protocols if protocol.startswith("bearer.")),
        "",
    )
    try:
        username = decode_access_token(token)
    except HTTPException:
        await websocket.close(code=4401, reason="Vui lòng đăng nhập lại.")
        return
    try:
        if not await user_collection.find_one({"username": username}, {"_id": 1}):
            await websocket.close(code=4401, reason="Tài khoản không còn tồn tại.")
            return
    except PyMongoError:
        logger.exception("Could not validate a quick-game player.")
        await websocket.close(code=1011, reason="Không thể kết nối cơ sở dữ liệu.")
        return

    await websocket.accept(subprotocol="arcade")
    completed_match = None
    try:
        await quick_game_manager.join(game, username, websocket)
        while True:
            event = await websocket.receive_json()
            if not isinstance(event, dict):
                await websocket.send_json({"type": "error", "message": "Dữ liệu trò chơi không hợp lệ."})
                continue
            if completed_match is None:
                game_id = quick_game_manager.player_matches.get((game, username))
                match = quick_game_manager.matches.get(game_id)
                if match:
                    completed_match = (game_id, tuple(match["players"]))
            await quick_game_manager.handle(game, username, websocket, event)
            if completed_match and completed_match[0] not in quick_game_manager.matches:
                await record_world_game(*completed_match)
                completed_match = None
    except (WebSocketDisconnect, WebSocketDisconnected):
        pass
    except PyMongoError:
        logger.exception("Quick-game WebSocket operation failed.")
        try:
            await websocket.close(code=1011, reason="Lỗi xử lý trò chơi.")
        except RuntimeError:
            pass
    finally:
        if completed_match is None:
            game_id = quick_game_manager.player_matches.get((game, username))
            match = quick_game_manager.matches.get(game_id)
            if match:
                completed_match = (game_id, tuple(match["players"]))
        await quick_game_manager.leave(game, username, websocket)
        if completed_match and completed_match[0] not in quick_game_manager.matches:
            await record_world_game(*completed_match)


async def send_socket_error(websocket: WebSocket, message: str):
    await websocket.send_json({"type": "error", "message": message})


@app.websocket("/ws/{room}/{username}")
async def websocket_endpoint(
    websocket: WebSocket,
    room: str,
    username: str,
):
    protocols = [
        protocol.strip()
        for protocol in websocket.headers.get("sec-websocket-protocol", "").split(",")
    ]
    token = next(
        (protocol.removeprefix("bearer.") for protocol in protocols if protocol.startswith("bearer.")),
        "",
    )
    try:
        token_username = decode_access_token(token)
    except HTTPException:
        await websocket.close(code=4401, reason="Vui lòng đăng nhập lại.")
        return
    if not hmac.compare_digest(token_username, username):
        await websocket.close(code=4403, reason="Tài khoản không khớp.")
        return
    try:
        room_access = await is_room_member(room, username)
    except HTTPException as exc:
        await websocket.close(
            code=1011 if exc.status_code == 503 else 4403,
            reason="Không thể xác thực cuộc trò chuyện.",
        )
        return
    if not room_access:
        await websocket.close(code=4403, reason="Bạn không thuộc cuộc trò chuyện này.")
        return
    try:
        if not await user_collection.find_one({"username": username}, {"_id": 1}):
            await websocket.close(code=4401, reason="Tài khoản không còn tồn tại.")
            return
    except PyMongoError:
        logger.exception("Could not validate a WebSocket user.")
        await websocket.close(code=1011, reason="Không thể kết nối cơ sở dữ liệu.")
        return

    await manager.connect(room, username, websocket)
    try:
        for online_username in await manager.online_users(room):
            await manager.broadcast_to_room(
                room, {"type": "presence", "username": online_username, "online": True}
            )
        while True:
            data = await websocket.receive_json()
            if not isinstance(data, dict):
                await send_socket_error(websocket, "Dữ liệu gửi lên không hợp lệ.")
                continue
            msg_type = data.get("type", "chat")

            if msg_type == "chat":
                content = data.get("content")
                if not isinstance(content, str) or not content.strip() or len(content) > 2000:
                    await send_socket_error(websocket, "Tin nhắn phải có từ 1 đến 2000 ký tự.")
                    continue
                message = {
                    "type": "chat",
                    "room": room,
                    "sender": username,
                    "content": content.strip(),
                    "timestamp": datetime.datetime.now(datetime.timezone.utc).strftime("%H:%M"),
                    "is_edited": False,
                    "is_deleted": False,
                }
                result = await message_collection.insert_one(message)
                message["_id"] = str(result.inserted_id)
                await manager.broadcast_to_room(room, message)
            elif msg_type == "call_signal":
                action = data.get("action")
                call_id = data.get("call_id")
                if (
                    not isinstance(action, str)
                    or action not in {
                        "invite", "join", "reject", "leave",
                        "offer", "answer", "ice",
                    }
                    or not isinstance(call_id, str)
                    or len(call_id) > 36
                ):
                    await send_socket_error(websocket, "Dữ liệu cuộc gọi không hợp lệ.")
                    continue
                try:
                    call_id = str(uuid.UUID(call_id))
                except ValueError:
                    await send_socket_error(websocket, "Mã cuộc gọi không hợp lệ.")
                    continue

                if action == "invite":
                    if not await call_manager.start(room, call_id, username):
                        await send_socket_error(websocket, "Cuộc gọi này đã được tạo.")
                        continue
                    await manager.broadcast_to_room(room, {
                        "type": "call_signal",
                        "action": "invite",
                        "call_id": call_id,
                        "sender": username,
                    })
                elif action == "join":
                    joined, participants = await call_manager.join(room, call_id, username)
                    if not joined:
                        message = (
                            f"Cuộc gọi nhóm đã đủ {MAX_CALL_PARTICIPANTS} người."
                            if participants else "Cuộc gọi không còn hoạt động."
                        )
                        await send_socket_error(websocket, message)
                        continue
                    await manager.broadcast_to_room(room, {
                        "type": "call_signal",
                        "action": "join",
                        "call_id": call_id,
                        "sender": username,
                    })
                elif action == "reject":
                    if not await call_manager.exists(room, call_id):
                        continue
                    await manager.broadcast_to_room(room, {
                        "type": "call_signal",
                        "action": "reject",
                        "call_id": call_id,
                        "sender": username,
                    })
                elif action == "leave":
                    left, _ = await call_manager.leave(room, call_id, username)
                    if left:
                        await manager.broadcast_to_room(room, {
                            "type": "call_signal",
                            "action": "peer_left",
                            "call_id": call_id,
                            "sender": username,
                        })
                elif action in {"offer", "answer", "ice"}:
                    target = data.get("target")
                    if not isinstance(target, str) or not re.fullmatch(r"[A-Za-z0-9_.-]{3,30}", target):
                        await send_socket_error(websocket, "Người nhận tín hiệu cuộc gọi không hợp lệ.")
                        continue
                    if not await call_manager.can_signal(room, call_id, username, target):
                        await send_socket_error(websocket, "Người tham gia không thuộc cuộc gọi này.")
                        continue
                    event = {
                        "type": "call_signal",
                        "action": action,
                        "call_id": call_id,
                        "sender": username,
                        "target": target,
                    }
                    if action in {"offer", "answer"}:
                        description = data.get("description")
                        if (
                            not isinstance(description, dict)
                            or description.get("type") != action
                            or not isinstance(description.get("sdp"), str)
                            or len(description["sdp"]) > 100_000
                        ):
                            await send_socket_error(websocket, "Mô tả kết nối cuộc gọi không hợp lệ.")
                            continue
                        event["description"] = {
                            "type": action,
                            "sdp": description["sdp"],
                        }
                    else:
                        candidate = data.get("candidate")
                        if (
                            not isinstance(candidate, dict)
                            or not isinstance(candidate.get("candidate"), str)
                            or len(candidate["candidate"]) > 4096
                            or (
                                candidate.get("sdpMid") is not None
                                and (
                                    not isinstance(candidate["sdpMid"], str)
                                    or len(candidate["sdpMid"]) > 256
                                )
                            )
                            or (
                                candidate.get("sdpMLineIndex") is not None
                                and (
                                    isinstance(candidate["sdpMLineIndex"], bool)
                                    or not isinstance(candidate["sdpMLineIndex"], int)
                                    or not 0 <= candidate["sdpMLineIndex"] <= 255
                                )
                            )
                        ):
                            await send_socket_error(websocket, "Tín hiệu mạng cuộc gọi không hợp lệ.")
                            continue
                        event["candidate"] = {
                            "candidate": candidate["candidate"],
                            "sdpMid": candidate.get("sdpMid"),
                            "sdpMLineIndex": candidate.get("sdpMLineIndex"),
                        }
                    if not await manager.send_to_user_in_room(room, target, event):
                        await send_socket_error(websocket, "Người tham gia đã ngắt kết nối.")
            elif msg_type == "music_sync":
                if room.startswith("group_"):
                    await send_socket_error(websocket, "Nghe/xem chung hiện chỉ hỗ trợ cuộc trò chuyện riêng.")
                    continue
                action = data.get("action")
                if not isinstance(action, str) or action not in {"invite", "join", "decline", "state", "leave"}:
                    await send_socket_error(websocket, "Thao tác nghe/xem chung không hợp lệ.")
                    continue
                event = {"type": "music_sync", "action": action, "sender": username}
                if action in {"invite", "state"}:
                    video_id = data.get("video_id")
                    playlist_id = data.get("playlist_id")
                    title = data.get("title", "")
                    position = data.get("position", 0)
                    playback_state = data.get("playback_state")
                    valid_video_id = isinstance(video_id, str) and re.fullmatch(
                        r"[A-Za-z0-9_-]{11}", video_id
                    )
                    valid_playlist_id = isinstance(playlist_id, str) and re.fullmatch(
                        r"[A-Za-z0-9_-]{10,100}", playlist_id
                    )
                    if (
                        not valid_video_id and not valid_playlist_id
                    ) or (
                        video_id not in (None, "") and not valid_video_id
                    ) or (
                        playlist_id not in (None, "") and not valid_playlist_id
                    ):
                        await send_socket_error(websocket, "Video hoặc playlist YouTube không hợp lệ.")
                        continue
                    if not isinstance(title, str) or len(title) > 100:
                        await send_socket_error(websocket, "Tên nội dung nghe/xem chung không hợp lệ.")
                        continue
                    if (
                        isinstance(position, bool)
                        or not isinstance(position, (int, float))
                        or not 0 <= position <= 86400
                        or not isinstance(playback_state, str)
                        or playback_state not in {"playing", "paused", "ended"}
                    ):
                        await send_socket_error(websocket, "Trạng thái phát nội dung không hợp lệ.")
                        continue
                    event.update({
                        "video_id": video_id if valid_video_id else "",
                        "playlist_id": playlist_id if valid_playlist_id else "",
                        "title": title,
                        "position": position,
                        "playback_state": playback_state,
                    })
                await manager.broadcast_to_room(room, event)
            elif msg_type in {"edit_message", "delete_message"}:
                message_id = data.get("message_id")
                if not isinstance(message_id, str) or not ObjectId.is_valid(message_id):
                    await send_socket_error(websocket, "Mã tin nhắn không hợp lệ.")
                    continue
                query = {"_id": ObjectId(message_id), "room": room, "sender": username}
                if msg_type == "edit_message":
                    new_content = data.get("new_content")
                    if not isinstance(new_content, str) or not new_content.strip() or len(new_content) > 2000:
                        await send_socket_error(websocket, "Tin nhắn phải có từ 1 đến 2000 ký tự.")
                        continue
                    update = {"$set": {"content": new_content.strip(), "is_edited": True}}
                    event = {"type": msg_type, "_id": message_id, "new_content": new_content.strip()}
                else:
                    update = {"$set": {"content": "Tin nhắn đã được thu hồi", "is_deleted": True}}
                    event = {"type": msg_type, "_id": message_id}
                result = await message_collection.update_one(query, update)
                if not result.matched_count:
                    await send_socket_error(websocket, "Không tìm thấy tin nhắn của bạn.")
                    continue
                await manager.broadcast_to_room(room, event)
            else:
                await send_socket_error(websocket, "Loại dữ liệu không được hỗ trợ.")
    except (WebSocketDisconnect, WebSocketDisconnected):
        pass
    except PyMongoError:
        logger.exception("WebSocket database operation failed.")
        try:
            await websocket.close(code=1011, reason="Không thể lưu tin nhắn.")
        except RuntimeError:
            pass
    finally:
        if await manager.disconnect(room, username, websocket):
            for call_id, _ in await call_manager.disconnect(room, username):
                try:
                    await manager.broadcast_to_room(room, {
                        "type": "call_signal",
                        "action": "peer_left",
                        "call_id": call_id,
                        "sender": username,
                    })
                except (RuntimeError, WebSocketDisconnect, WebSocketDisconnected):
                    logger.debug("Could not broadcast a call update for %s.", username)
            try:
                await manager.broadcast_to_room(
                    room, {"type": "presence", "username": username, "online": False}
                )
            except (RuntimeError, WebSocketDisconnect, WebSocketDisconnected):
                logger.debug("Could not broadcast a presence update for %s.", username)


@app.post("/api/groups")
async def create_group(
    data: GroupCreateSchema,
    current_user: Annotated[str, Depends(get_current_username)],
):
    members = list(dict.fromkeys([*data.members, current_user]))
    if len(members) < 2:
        raise HTTPException(status_code=400, detail="Nhóm phải có ít nhất 2 thành viên.")
    try:
        registered_members = await user_collection.find(
            {"username": {"$in": members}}, {"username": 1, "_id": 0}
        ).to_list(length=50)
    except PyMongoError as exc:
        raise HTTPException(status_code=503, detail="Không thể xác thực thành viên nhóm.") from exc
    registered_usernames = {user["username"] for user in registered_members}
    if registered_usernames != set(members):
        raise HTTPException(status_code=400, detail="Một hoặc nhiều tài khoản không tồn tại.")

    group_id = f"group_{uuid.uuid4().hex}"
    group_doc = {
        "_id": group_id,
        "name": data.name,
        "created_by": current_user,
        "members": members,
        "created_at": datetime.datetime.now(datetime.timezone.utc),
    }
    try:
        await database["groups"].insert_one(group_doc)
    except PyMongoError as exc:
        raise HTTPException(status_code=503, detail="Không thể tạo nhóm.") from exc
    return {"id": group_id, "name": data.name, "members": members}


@app.get("/api/groups")
async def get_my_groups(current_user: Annotated[str, Depends(get_current_username)]):
    try:
        cursor = database["groups"].find({"members": current_user}).sort("created_at", -1)
        groups = await cursor.to_list(length=100)
    except PyMongoError as exc:
        raise HTTPException(status_code=503, detail="Không thể tải danh sách nhóm.") from exc
    return [
        {
            "id": group["_id"],
            "name": group["name"],
            "members": group.get("members", []),
            "created_by": group.get("created_by", ""),
        }
        for group in groups
    ]


@app.get("/api/groups/{group_id}/messages")
async def get_group_messages(
    group_id: str,
    current_user: Annotated[str, Depends(get_current_username)],
):
    try:
        group = await database["groups"].find_one({"_id": group_id, "members": current_user})
        if not group:
            raise HTTPException(status_code=403, detail="Bạn không có quyền truy cập nhóm này.")
        cursor = (
            message_collection.find(
                {"$or": [{"room": group_id}, {"room_id": group_id}]}
            )
            .sort("_id", -1)
            .limit(200)
        )
        messages = await cursor.to_list(length=200)
    except PyMongoError as exc:
        raise HTTPException(status_code=503, detail="Không thể tải tin nhắn nhóm.") from exc
    for message in messages:
        message["_id"] = str(message["_id"])
        message.setdefault("room", group_id)
    messages.reverse()
    return messages


UPLOAD_TYPES = {
    "image/jpeg": (".jpg", lambda data: data.startswith(b"\xff\xd8\xff")),
    "image/png": (".png", lambda data: data.startswith(b"\x89PNG\r\n\x1a\n")),
    "image/gif": (".gif", lambda data: data.startswith((b"GIF87a", b"GIF89a"))),
    "image/webp": (
        ".webp",
        lambda data: len(data) >= 12 and data.startswith(b"RIFF") and data[8:12] == b"WEBP",
    ),
    "video/mp4": (".mp4", lambda data: len(data) >= 8 and data[4:8] == b"ftyp"),
    "video/webm": (".webm", lambda data: data.startswith(b"\x1a\x45\xdf\xa3")),
}


@app.post("/api/upload", status_code=201)
async def upload_file(
    request: Request,
    file: Annotated[UploadFile, File()],
    _: Annotated[str, Depends(get_current_username)],
):
    temporary_path: Path | None = None
    try:
        content_length = request.headers.get("content-length")
        if content_length and content_length.isdigit() and int(content_length) > MAX_UPLOAD_BYTES + 1024 * 1024:
            raise HTTPException(status_code=413, detail="Tệp vượt quá giới hạn 20 MB.")
        upload_type = UPLOAD_TYPES.get(file.content_type or "")
        if not upload_type:
            raise HTTPException(status_code=400, detail="Định dạng tệp không được hỗ trợ.")

        UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
        extension, signature_matches = upload_type
        total_size = 0
        signature = bytearray()
        with tempfile.NamedTemporaryFile(dir=UPLOAD_DIR, suffix=".tmp", delete=False) as temporary_file:
            temporary_path = Path(temporary_file.name)
            while chunk := await file.read(64 * 1024):
                total_size += len(chunk)
                if total_size > MAX_UPLOAD_BYTES:
                    raise HTTPException(status_code=413, detail="Tệp vượt quá giới hạn 20 MB.")
                signature.extend(chunk[: max(0, 12 - len(signature))])
                temporary_file.write(chunk)
        if not signature or not signature_matches(signature):
            raise HTTPException(status_code=400, detail="Nội dung tệp không khớp với định dạng đã chọn.")
        filename = f"{uuid.uuid4().hex}{extension}"
        os.replace(temporary_path, UPLOAD_DIR / filename)
        temporary_path = None
    finally:
        if temporary_path and temporary_path.exists():
            temporary_path.unlink()
        await file.close()

    return {
        "url": f"/uploads/{filename}",
        "type": "image" if file.content_type.startswith("image/") else "video",
    }


@app.get("/uploads/{filename}")
async def get_uploaded_file(
    filename: str,
    username: Annotated[str, Depends(get_current_username)],
):
    if not re.fullmatch(
        r"(?:[a-f0-9]{32}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\.(?:jpeg|jpg|png|gif|webp|mp4|webm)",
        filename,
    ):
        raise HTTPException(status_code=404, detail="Không tìm thấy tệp.")
    file_path = UPLOAD_DIR / filename
    try:
        message = await message_collection.find_one(
            {
                "content": f"/uploads/{filename}",
                "$or": [{"room": {"$exists": True}}, {"room_id": {"$exists": True}}],
            },
            {"room": 1, "room_id": 1},
        )
    except PyMongoError as exc:
        raise HTTPException(status_code=503, detail="Không thể xác thực quyền xem tệp.") from exc
    room = message.get("room", message.get("room_id", "")) if message else ""
    if not message or not await is_room_member(room, username) or not file_path.is_file():
        raise HTTPException(status_code=404, detail="Không tìm thấy tệp.")
    media_type = {
        ".jpeg": "image/jpeg",
        ".jpg": "image/jpeg",
        ".png": "image/png",
        ".gif": "image/gif",
        ".webp": "image/webp",
        ".mp4": "video/mp4",
        ".webm": "video/webm",
    }[file_path.suffix]
    return FileResponse(
        file_path,
        media_type=media_type,
        headers={"Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff"},
    )


app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")