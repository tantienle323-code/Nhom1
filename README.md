# Chat Realtime MVP

Ứng dụng chat 1-1 dùng FastAPI, WebSocket và MongoDB. Backend đồng thời phục vụ giao diện web tại `http://127.0.0.1:8000`.

## Chạy trên Windows

1. Cài MongoDB và bảo đảm `MONGO_URI` trong `backend/.env` trỏ đến database đang chạy.
2. Tạo file cấu hình riêng không được Git theo dõi:

   ```powershell
   Copy-Item backend\.env.local.example backend\.env.local
   code backend\.env.local
   ```

   Đặt `AUTH_SECRET` thành chuỗi ngẫu nhiên bền vững (có thể tạo bằng `.\backend\venv\Scripts\python.exe -c "import secrets; print(secrets.token_urlsafe(48))"`), chọn `ADMIN_USERNAME` và mật khẩu admin tối thiểu 8 ký tự. Không commit các giá trị bí mật vào Git. Admin được tạo tự động khi khởi động lần đầu; nếu tài khoản đó đã có trong database, mật khẩu hiện tại không bị ghi đè.

3. Khởi chạy:

   ```powershell
   .\backend\venv\Scripts\python.exe -m uvicorn main:app --app-dir backend --reload
   ```

4. Mở `http://127.0.0.1:8000`, đăng nhập admin hoặc đăng ký tài khoản chat mới. Trang quản trị dùng đường dẫn `/admin.html`.
5. Trong chat, chọn **Chơi game** để mở Game Center ở tab mới; có thể chọn Xếp gạch, Cờ caro, Oẳn tù tì hoặc Đấu vui mà vẫn giữ tab chat và nhạc YouTube đang phát. Trong trình phát nhạc cũng có nút **Chơi game ở tab mới**. Hai người chơi đăng nhập bằng hai tài khoản ở hai trình duyệt/thiết bị và cùng nhấn **Tìm trận**; caro chơi lần lượt, oẳn tù tì chơi BO3, đấu vui là trò phản xạ với nhân vật hoạt hình (không có đánh nhau thật). Xếp gạch hỗ trợ phím mũi tên và Space; trên điện thoại có nút cảm ứng.
6. Trong một cuộc trò chuyện riêng, chọn **Thế giới đôi** để xem địa danh và tiến trình chung. Tin nhắn và trận game đã hoàn thành góp điểm mở cột mốc; kỷ niệm chỉ được lưu khi người dùng chủ động ghim từ tin nhắn hoặc tự nhập. Mỗi người chỉ có thể xóa kỷ niệm do mình tạo.
7. Chọn **🎵 Nhạc** trong chat để mở trình phát cá nhân. Dán link HTTPS của video hoặc playlist YouTube, thêm vào danh sách và phát trong khung YouTube. Danh sách link lưu riêng trong trình duyệt theo tài khoản; video được phát từ YouTube, không tải lên máy chủ chat hay tự chia sẻ với người đang trò chuyện.

Nếu chưa cấu hình `ADMIN_USERNAME` và `ADMIN_PASSWORD`, các chức năng chat vẫn chạy nhưng trang quản trị bị vô hiệu hóa. Nếu chưa cấu hình `AUTH_SECRET`, máy chủ tạo khóa tạm thời và phiên đăng nhập sẽ mất khi backend khởi động lại.

## Kiểm tra

```powershell
.\backend\venv\Scripts\python.exe -m unittest discover -s backend\tests
```

`GET /api/health` kiểm tra trạng thái kết nối MongoDB.
