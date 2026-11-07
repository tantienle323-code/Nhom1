# Chat Realtime

Ứng dụng chat riêng và chat nhóm dùng FastAPI, WebSocket và MongoDB. Backend phục vụ giao diện tại `http://127.0.0.1:8000`.

## Chạy trên Windows

1. Cài MongoDB và bảo đảm `MONGO_URI` trong `backend/.env` trỏ đến database đang chạy.
2. Tạo file cấu hình riêng không được Git theo dõi:

   ```powershell
   Copy-Item backend\.env.local.example backend\.env.local
   code backend\.env.local
   ```

   Đặt `AUTH_SECRET` thành chuỗi ngẫu nhiên bền vững (có thể tạo bằng `.\backend\venv\Scripts\python.exe -c "import secrets; print(secrets.token_urlsafe(48))"`), chọn `ADMIN_USERNAME` và mật khẩu admin tối thiểu 8 ký tự. Giữ `ENVIRONMENT=development` khi phát triển; môi trường production bắt buộc có `AUTH_SECRET` và danh sách `CORS_ORIGINS` phải khớp chính xác với domain frontend. Không commit các giá trị bí mật vào Git. Admin được tạo tự động khi khởi động lần đầu; nếu tài khoản đó đã có trong database, mật khẩu hiện tại không bị ghi đè.

3. Khởi chạy:

   ```powershell
   .\backend\venv\Scripts\python.exe -m uvicorn main:app --app-dir backend --reload
   ```

4. Mở `http://127.0.0.1:8000`, đăng nhập admin hoặc đăng ký tài khoản chat mới. Có thể tạo nhóm, mời tài khoản đã đăng ký, xem lịch sử và trò chuyện realtime; mọi tin nhắn nhóm được lưu cùng cơ chế thành viên của nhóm. Trang quản trị dùng đường dẫn `/admin.html`.
5. Trong chat, chọn **Chơi game** để mở Game Center ở tab mới; có thể chọn Xếp gạch, Cờ caro, Oẳn tù tì hoặc Đấu vui mà vẫn giữ tab chat và nhạc YouTube đang phát. Trong trình phát nhạc cũng có nút **Chơi game ở tab mới**. Hai người chơi đăng nhập bằng hai tài khoản ở hai trình duyệt/thiết bị và cùng nhấn **Tìm trận**; caro chơi lần lượt, oẳn tù tì chơi BO3, đấu vui là trò phản xạ với nhân vật hoạt hình (không có đánh nhau thật). Xếp gạch hỗ trợ phím mũi tên và Space; trên điện thoại có nút cảm ứng.
6. Trong một cuộc trò chuyện riêng, chọn **Thế giới đôi** để xem địa danh và tiến trình chung. Tin nhắn và trận game đã hoàn thành góp điểm mở cột mốc; kỷ niệm chỉ được lưu khi người dùng chủ động ghim từ tin nhắn hoặc tự nhập. Mỗi người chỉ có thể xóa kỷ niệm do mình tạo.
7. Chọn **🎵 Nhạc** trong chat để mở trình phát cá nhân. Dán link HTTPS của video hoặc playlist YouTube, thêm vào danh sách và phát trong khung YouTube. Danh sách link lưu riêng trong trình duyệt theo tài khoản; video được phát từ YouTube, không tải lên máy chủ chat hay tự chia sẻ với người đang trò chuyện.
8. Có thể gửi ảnh PNG/JPEG/GIF/WebP hoặc video MP4/WebM tối đa 20 MB bằng nút đính kèm; dùng nút 📷 trong khung chat để chụp ảnh hoặc quay video có âm thanh rồi xem lại trước khi gửi. Cần cấp quyền camera và micro khi được hỏi; camera hoạt động trên HTTPS hoặc localhost. Tệp được giới hạn kích thước, kiểm tra chữ ký định dạng và chỉ thành viên của cuộc trò chuyện chứa tệp mới xem được.
9. Chọn nút 😊 cạnh ô nhập tin nhắn để mở bảng emoji; nhấn emoji để chèn tại vị trí con trỏ rồi gửi như tin nhắn bình thường.

Trong cuộc trò chuyện riêng, mở **🎵 Nhạc**, phát video YouTube rồi chọn **Mời nghe/xem chung**. Đối phương cần chọn **Tham gia**; sau đó cả hai mở cùng video và đồng bộ phát, tạm dừng hoặc tua trong lúc đang kết nối. YouTube phát trực tiếp trên từng thiết bị nên mỗi máy cần truy cập được YouTube; trình duyệt có thể yêu cầu người tham gia tự bấm Play để bật âm thanh. Nếu video không cho nhúng hoặc mạng chặn YouTube, khung phát trên máy đó không thể hiển thị video; trạng thái báo lỗi được giữ nguyên thay vì bị ghi đè bởi tín hiệu đồng bộ, và có thể dùng **Mở trên YouTube**. Chất lượng và kích thước hình ảnh có thể khác theo thiết bị/mạng. Danh sách phát cá nhân không bị chia sẻ.

Trong chat riêng hoặc nhóm, chọn **📹 Gọi**, cho phép dùng camera/micro rồi người nhận chọn tham gia. Cuộc gọi hỗ trợ tắt/bật camera và micro, chia sẻ màn hình, từ chối và kết thúc; tối đa 4 người cùng tham gia một cuộc gọi nhóm. Video và âm thanh truyền trực tiếp giữa các trình duyệt bằng WebRTC, không đi qua máy chủ chat. Trình duyệt yêu cầu **HTTPS** để truy cập camera/micro trên thiết bị khác (localhost được phép dùng HTTP). Cấu hình STUN hiện tại hỗ trợ một số kết nối; nếu các thiết bị ở những mạng khác nhau và không kết nối được thì cần triển khai HTTPS và máy chủ TURN riêng.

Nếu chưa cấu hình `ADMIN_USERNAME` và `ADMIN_PASSWORD`, các chức năng chat vẫn chạy nhưng trang quản trị bị vô hiệu hóa. Ở môi trường phát triển, nếu chưa cấu hình `AUTH_SECRET`, máy chủ tạo khóa tạm thời và phiên đăng nhập sẽ mất khi backend khởi động lại. Không dùng cấu hình đó khi triển khai production.

## Kiểm tra

```powershell
.\backend\venv\Scripts\python.exe -m unittest discover -s backend\tests
```

`GET /api/health` kiểm tra trạng thái kết nối MongoDB.

## Dùng máy khác trong cùng mạng Wi-Fi

Đây là cách chia sẻ trong mạng nội bộ, không tạo website công khai trên Internet:

1. Kết nối cả hai máy vào cùng mạng Wi-Fi đáng tin cậy. Nếu Windows đang đánh dấu Wi-Fi là **Public**, chỉ chuyển sang **Private** khi đó là mạng gia đình/trường học mà bạn tin cậy.
2. Trên máy chủ chạy ứng dụng, mở PowerShell tại thư mục dự án và khởi động backend để lắng nghe kết nối trong mạng:

   ```powershell
   .\backend\venv\Scripts\python.exe -m uvicorn main:app --app-dir backend --host 0.0.0.0 --port 8000
   ```

3. Nếu Windows Firewall chặn kết nối, mở PowerShell **Run as administrator** và thêm luật chỉ cho phép thiết bị trong mạng nội bộ:

   ```powershell
   New-NetFirewallRule -DisplayName "Chat Realtime - LAN" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 8000 -Profile Private -RemoteAddress LocalSubnet
   ```

4. Trên máy chủ, tìm địa chỉ IPv4:

   ```powershell
   Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.InterfaceAlias -eq "Wi-Fi" -and $_.IPAddress -notlike "169.254.*" } | Select-Object -ExpandProperty IPAddress
   ```

   Trên máy khác, mở `http://DIA-CHI-IP:8000` (ví dụ `http://10.0.0.25:8000`). Máy chủ cần bật và backend phải tiếp tục chạy. Nếu Wi-Fi cấp IP mới, hãy tra lại địa chỉ.

Không tạo port forwarding trên router và không mở luật firewall cho mọi mạng: hướng dẫn này chỉ dành cho cùng một mạng nội bộ. Muốn chia sẻ qua Internet cần triển khai lên dịch vụ host riêng; chưa có dịch vụ công khai nào được tạo.
