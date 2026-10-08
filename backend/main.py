from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from motor.motor_asyncio import AsyncIOMotorClient
import datetime

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Kết nối Database (Local hoặc Atlas)
MONGO_URL = "mongodb+srv://admin:<db_password>@khang.8uvqzff.mongodb.net/?appName=khang"
client = AsyncIOMotorClient(MONGO_URL)
db = client["chat_db"]
messages_collection = db["messages"]

class LoginSchema(BaseModel):
    username: str

@app.post("/api/login")
async def login(data: LoginSchema):
    return {"status": "ok", "username": data.username}

@app.get("/api/messages/{room}")
async def get_messages(room: str):
    # Lấy 50 tin nhắn gần nhất theo phòng
    cursor = messages_collection.find({"room": room}, {"_id": 0}).sort("timestamp", -1).limit(50)
    messages = await cursor.to_list(length=50)
    messages.reverse()
    return messages

# QUẢN LÝ WEBSOCKET & MULTI-ROOM
class ConnectionManager:
    def __init__(self):
        # Lưu kết nối dạng: { room_name: { username: websocket } }
        self.rooms: dict[str, dict[str, WebSocket]] = {}

    async def connect(self, room: str, username: str, websocket: WebSocket):
        await websocket.accept()
        if room not in self.rooms:
            self.rooms[room] = {}
        self.rooms[room][username] = websocket
        
        # Báo cho phòng biết có người mới vào + gửi danh sách online
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
            timestamp = datetime.datetime.now().strftime("%H:%M")
            
            msg_doc = {
                "type": "chat",
                "room": room,
                "sender": username,
                "content": data["content"],
                "timestamp": timestamp
            }
            
            # Lưu vào MongoDB
            await messages_collection.insert_one(msg_doc)
            
            # Xóa _id do MongoDB tự sinh ra trước khi broadcast
            msg_doc.pop("_id", None)
            await manager.broadcast_to_room(room, msg_doc)
            
    except WebSocketDisconnect:
        manager.disconnect(room, username)
        await manager.broadcast_system_message(room, f"🔴 {username} đã rời phòng.")
        await manager.broadcast_user_list(room) 