from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from database import user_collection, message_collection, room_collection
from pymongo.errors import PyMongoError
from bson import ObjectId
import bcrypt
import datetime

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

MONGO_URL = "mongodb+srv://admin:ankhang2006@khang.8uvqzff.mongodb.net/chat_db?retryWrites=true&w=majority"

# Cấu hình mã hóa trực tiếp dùng thư viện bcrypt gốc (Tránh hoàn toàn lỗi 72 bytes của passlib)
def hash_password(password: str) -> str:
    pwd_bytes = str(password).encode('utf-8')[:72]
    salt = bcrypt.gensalt()
    hashed = bcrypt.hashpw(pwd_bytes, salt)
    return hashed.decode('utf-8')

def verify_password(plain_password: str, hashed_password: str) -> bool:
    pwd_bytes = str(plain_password).encode('utf-8')[:72]
    hashed_bytes = str(hashed_password).encode('utf-8')
    return bcrypt.checkpw(pwd_bytes, hashed_bytes)

class AuthSchema(BaseModel):
    username: str
    password: str

# API ĐĂNG KÝ TÀI KHOẢN MỚI
@app.post("/api/register")
async def register(data: AuthSchema):
    username = data.username.strip()
    password = data.password.strip()

    if not username or not password:
        raise HTTPException(status_code=400, detail="Vui lòng nhập đầy đủ tài khoản và mật khẩu!")

    existing_user = await user_collection.find_one({"username": username})
    if existing_user:
        raise HTTPException(status_code=400, detail="Tài khoản đã tồn tại!")

    hashed_pwd = hash_password(password)
    new_user = {
        "username": username,
        "password": hashed_pwd,
        "created_at": datetime.datetime.now()
    }
    await user_collection.insert_one(new_user)
    return {"status": "ok", "message": "Đăng ký thành công!"}

# API ĐĂNG NHẬP
@app.post("/api/login")
async def login(data: AuthSchema):
    username = data.username.strip()
    password = data.password.strip()

    user = await user_collection.find_one({"username": username})
    if not user or not verify_password(password, user["password"]):
        raise HTTPException(status_code=401, detail="Sai tài khoản hoặc mật khẩu!")

    return {"status": "ok", "username": username}

@app.get("/api/messages/{room}")
async def get_messages(room: str):
    try:
        cursor = message_collection.find(
            {"room": room}
        ).sort("timestamp", -1).limit(50)
        messages = await cursor.to_list(length=50)
        
        for msg in messages:
            msg["_id"] = str(msg["_id"])
            
    except PyMongoError as exc:
        raise HTTPException(
            status_code=503,
            detail="Không thể kết nối MongoDB. Hãy kiểm tra MONGO_URI trong backend/.env.",
        ) from exc

    messages.reverse()
    return messages

# --- CÁC API DÀNH CHO ADMIN QUẢN LÝ TÀI KHOẢN ---

# 1. Lấy danh sách tất cả tài khoản
@app.get("/api/admin/users")
async def get_all_users():
    try:
        cursor = user_collection.find({}, {"password": 0})
        users = await cursor.to_list(length=100)
        for u in users:
            u["_id"] = str(u["_id"])
            if "created_at" in u and isinstance(u["created_at"], datetime.datetime):
                u["created_at"] = u["created_at"].strftime("%Y-%m-%d %H:%M")
        return users
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# 2. Xóa tài khoản
@app.delete("/api/admin/users/{user_id}")
async def delete_user(user_id: str):
    result = await user_collection.delete_one({"_id": ObjectId(user_id)})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Không tìm thấy tài khoản")
    return {"status": "ok", "message": "Đã xóa tài khoản thành công"}

# 3. Đổi mật khẩu cho user
class ResetPasswordSchema(BaseModel):
    new_password: str

@app.put("/api/admin/users/{user_id}/reset-password")
async def reset_user_password(user_id: str, data: ResetPasswordSchema):
    hashed_pwd = hash_password(data.new_password)
    result = await user_collection.update_one(
        {"_id": ObjectId(user_id)},
        {"$set": {"password": hashed_pwd}}
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Không tìm thấy tài khoản")
    return {"status": "ok", "message": "Đã đổi mật khẩu thành công"}

# --- CÁC API DÀNH CHO PROFILE ---

class UpdateProfileSchema(BaseModel):
    bio: str = ""
    avatar_url: str = ""

# 1. Lấy thông tin cá nhân
@app.get("/api/profile/{username}")
async def get_profile(username: str):
    user = await user_collection.find_one({"username": username}, {"password": 0})
    if not user:
        raise HTTPException(status_code=404, detail="Không tìm thấy người dùng")
    user["_id"] = str(user["_id"])
    if "created_at" in user and isinstance(user["created_at"], datetime.datetime):
        user["created_at"] = user["created_at"].strftime("%Y-%m-%d %H:%M")
    return user

# 2. Cập nhật thông tin cá nhân (Bio, Avatar URL)
@app.put("/api/profile/{username}")
async def update_profile(username: str, data: UpdateProfileSchema):
    result = await user_collection.update_one(
        {"username": username},
        {"$set": {"bio": data.bio, "avatar_url": data.avatar_url}}
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Không tìm thấy người dùng")
    return {"status": "ok", "message": "Cập nhật trang cá nhân thành công!"}

# QUẢN LÝ WEBSOCKET & MULTI-ROOM
class ConnectionManager:
    def __init__(self):
        self.rooms: dict[str, dict[str, WebSocket]] = {}

    async def connect(self, room: str, username: str, websocket: WebSocket):
        await websocket.accept()
        if room not in self.rooms:
            self.rooms[room] = {}
        self.rooms[room][username] = websocket
        
        await self.broadcast_system_message(room, f"🟢 {username} đã tham gia phòng.")
        await self.broadcast_user_list(room)

    def disconnect(self, room: str, username: str):
        if room in self.rooms and username in self.rooms[room]:
            del self.rooms[room][username]

    async def broadcast_to_room(self, room: str, message_data: dict):
        if room in self.rooms:
            for connection in self.rooms[room].values():
                await connection.send_json(message_data)

    async def broadcast_system_message(self, room: str, text: str):
        sys_msg = {
            "type": "system",
            "content": text,
            "timestamp": datetime.datetime.now().strftime("%H:%M")
        }
        await self.broadcast_to_room(room, sys_msg)

    async def broadcast_user_list(self, room: str):
        if room in self.rooms:
            user_list = list(self.rooms[room].keys())
            msg = {
                "type": "user_list",
                "users": user_list
            }
            await self.broadcast_to_room(room, msg)

manager = ConnectionManager()

@app.websocket("/ws/{room}/{username}")
async def websocket_endpoint(websocket: WebSocket, room: str, username: str):
    await manager.connect(room, username, websocket)
    try:
        while True:
            data = await websocket.receive_json()
            msg_type = data.get("type", "chat")
            
            if msg_type == "chat":
                timestamp = datetime.datetime.now().strftime("%H:%M")
                msg_doc = {
                    "type": "chat",
                    "room": room,
                    "sender": username,
                    "content": data["content"],
                    "timestamp": timestamp,
                    "is_edited": False,
                    "is_deleted": False
                }
                
                result = await message_collection.insert_one(msg_doc)
                msg_doc["_id"] = str(result.inserted_id)
                
                await manager.broadcast_to_room(room, msg_doc)

            elif msg_type == "edit_message":
                msg_id = data.get("message_id")
                new_content = data.get("new_content")
                
                await message_collection.update_one(
                    {"_id": ObjectId(msg_id), "sender": username},
                    {"$set": {"content": new_content, "is_edited": True}}
                )
                
                await manager.broadcast_to_room(room, {
                    "type": "edit_message",
                    "_id": msg_id,
                    "new_content": new_content
                })

            elif msg_type == "delete_message":
                msg_id = data.get("message_id")
                
                await message_collection.update_one(
                    {"_id": ObjectId(msg_id), "sender": username},
                    {"$set": {"content": "Tin nhắn đã được thu hồi", "is_deleted": True}}
                )
                
                await manager.broadcast_to_room(room, {
                    "type": "delete_message",
                    "_id": msg_id
                })


    except WebSocketDisconnect:
        manager.disconnect(room, username)
        await manager.broadcast_system_message(room, f"🔴 {username} đã rời phòng.")
        await manager.broadcast_user_list(room)