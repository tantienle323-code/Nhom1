from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel
from typing import List
import json

app = FastAPI()

# 1. CẤU HÌNH CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 2. KHAI BÁO MONGODB ATLAS (Điền chuỗi kết nối của ní vào đây)
MONGO_URL = "mongodb+srv://admin:<db_password>@khang.8uvqzff.mongodb.net/?appName=khang"

client = AsyncIOMotorClient(MONGO_URL)
db = client["chat_db"]
messages_collection = db["messages"]


# 3. REST API
class LoginSchema(BaseModel):
    username: str

@app.post("/api/login")
async def login(data: LoginSchema):
    return {"status": "ok", "username": data.username}

@app.get("/api/messages")
async def get_messages():
    # Lấy 50 tin nhắn gần nhất từ MongoDB Atlas
    cursor = messages_collection.find({}, {"_id": 0}).sort("_id", -1).limit(50)
    messages = await cursor.to_list(length=50)
    messages.reverse()
    return messages


# 4. QUẢN LÝ WEBSOCKET
class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def broadcast(self, message: dict):
        for connection in list(self.active_connections):
            try:
                await connection.send_text(json.dumps(message))
            except Exception:
                self.disconnect(connection)

manager = ConnectionManager()


# 5. WEBSOCKET ENDPOINT
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            data_str = await websocket.receive_text()
            data = json.loads(data_str)
            
            sender = data.get("sender")
            content = data.get("content")

            if sender and content:
                # Lưu vào MongoDB Atlas
                try:
                    await messages_collection.insert_one({
                        "sender": sender,
                        "content": content
                    })
                except Exception as e:
                    print(f"Lỗi lưu DB: {e}")

                # Gửi cho tất cả client
                await manager.broadcast({
                    "sender": sender,
                    "content": content
                })

    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception as e:
        print(f"Lỗi WebSocket: {e}")
        manager.disconnect(websocket)