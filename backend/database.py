import os
import datetime
from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field

# Load cấu hình riêng trước, sau đó dùng .env hiện có làm giá trị mặc định.
backend_dir = os.path.dirname(__file__)
load_dotenv(os.path.join(backend_dir, ".env.local"))
load_dotenv(os.path.join(backend_dir, ".env"))

# Lấy chuỗi kết nối từ .env
MONGO_URI = os.getenv("MONGO_URI")

if not MONGO_URI:
    raise RuntimeError("MONGO_URI must be configured in backend/.env")

# Khởi tạo Async MongoDB Client
client = AsyncIOMotorClient(MONGO_URI, serverSelectionTimeoutMS=5000)

# Chọn database
database = client["chat_db"]

# Khai báo các collection
user_collection = database.get_collection("users")
message_collection = database.get_collection("messages")
room_collection = database.get_collection("rooms")
world_memory_collection = database.get_collection("world_memories")
world_game_collection = database.get_collection("world_games")


# ==========================================
# PYDANTIC SCHEMAS (Định nghĩa kiểu dữ liệu)
# ==========================================

class UserSchema(BaseModel):
    username: str = Field(..., min_length=3, max_length=30, example="nguyenvana")
    password_hash: str = Field(..., example="$2b$12$eImiTXuWVm...")
    created_at: datetime.datetime = Field(default_factory=datetime.datetime.utcnow)

class MessageSchema(BaseModel):
    sender_username: str = Field(..., example="nguyenvana")
    room_name: str = Field(default="global", example="global")
    content: str = Field(..., min_length=1, max_length=1000, example="Chào mọi người!")
    timestamp: datetime.datetime = Field(default_factory=datetime.datetime.utcnow)

class RoomSchema(BaseModel):
    room_name: str = Field(..., example="global")
    created_by: str = Field(..., example="admin")
    created_at: datetime.datetime = Field(default_factory=datetime.datetime.utcnow)