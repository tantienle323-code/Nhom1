import os
import datetime
from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field

# Load biến môi trường từ file .env
load_dotenv()

# Lấy chuỗi kết nối từ .env
MONGO_URI = os.getenv("MONGO_URI")

if not MONGO_URI:
    # Chuỗi URI mặc định phòng trường hợp chưa cài .env (Thay <username> & <password> nếu cần)
    MONGO_URI = "mongodb+srv://<username>:<password>@cluster0.mongodb.net/chat_db?retryWrites=true&w=majority"

# Khởi tạo Async MongoDB Client
client = AsyncIOMotorClient(MONGO_URI, serverSelectionTimeoutMS=5000)

# Chọn database
database = client["chat_db"]

# Khai báo các collection
user_collection = database.get_collection("users")
message_collection = database.get_collection("messages")
room_collection = database.get_collection("rooms")


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