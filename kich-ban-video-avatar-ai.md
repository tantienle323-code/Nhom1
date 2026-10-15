# Gói nội dung video avatar AI: Chat Realtime MVP

## Thiết lập video

- **Tỉ lệ khung hình:** 16:9, 1920 × 1080
- **Thời lượng mục tiêu:** khoảng 1 phút 55 giây
- **Ngôn ngữ:** Tiếng Việt
- **Giọng đọc:** trẻ trung, rõ chữ, lịch sự; tốc độ vừa phải, phát âm tiếng Việt tự nhiên
- **Phong cách:** thuyết trình đại học, hiện đại, thân thiện và chuyên nghiệp
- **Avatar:** sinh viên Việt Nam mặc trang phục lịch sự, đứng lệch một bên để không che sơ đồ và tiêu đề
- **Lưu ý dựng:** Không yêu cầu AI tạo chữ trong hình. Thêm tiêu đề, nhãn giao thức và phụ đề bằng trình biên tập để tránh lỗi chính tả.

## Kịch bản chia cảnh

| Cảnh | Thời gian | Hình ảnh và chữ trên màn hình | Lời thoại |
|---|---|---|---|
| 1. Mở đầu | 00:00–00:14 | Avatar chào khán giả trong lớp học hoặc nền công nghệ. Tiêu đề: **Chat Realtime MVP**; dòng phụ: **Minh họa HTTP và WebSocket**. | Xin kính chào thầy và toàn thể các bạn! Hôm nay, nhóm chúng em xin trình bày bài tập nhóm số 2 với đề tài: Minh họa giao thức HTTP và WebSocket trong ứng dụng Chat Realtime MVP. |
| 2. HTTP truyền thống | 00:14–00:31 | Sơ đồ Client → Request → Server → Response. Cho mũi tên request lặp lại; nhấn các nhãn **Độ trễ** và **Header lặp lại**. | Đầu tiên là giao thức HTTP truyền thống. HTTP hoạt động theo cơ chế Request – Response: Client gửi yêu cầu, Server trả lời. Muốn nhận dữ liệu mới, Client thường phải gửi thêm yêu cầu. Việc này có thể gây độ trễ và tạo thêm lưu lượng do header được gửi lặp lại. |
| 3. Giải pháp WebSocket | 00:31–00:39 | Chuyển từ nhiều mũi tên HTTP sang một đường kết nối hai chiều. Tiêu đề: **WebSocket – kết nối thời gian thực**. | Để hỗ trợ trao đổi dữ liệu thời gian thực, nhóm chúng em sử dụng WebSocket. Kết nối WebSocket được thiết lập qua ba giai đoạn chính. |
| 4. Giai đoạn 1 — Handshake | 00:39–00:53 | Sơ đồ Client → Server. Hiện lần lượt: **HTTP Upgrade: websocket**, **101 Switching Protocols**. | Giai đoạn một là Handshake. Client gửi HTTP request yêu cầu nâng cấp kết nối với header Upgrade: websocket. Nếu đồng ý, Server phản hồi mã 101 Switching Protocols để bắt đầu kết nối WebSocket. |
| 5. Giai đoạn 2 — Truyền tin hai chiều | 00:53–01:16 | Sơ đồ hai chiều **Client ↔ FastAPI**; từ FastAPI nối tới **MongoDB** và nhiều Client trong cùng phòng. Hiện các nhãn **Full-Duplex**, **Lưu tin nhắn**, **Broadcast**. | Giai đoạn hai là truyền tin Full-Duplex: hai phía có thể gửi dữ liệu qua lại trên cùng kết nối. Trong ứng dụng của nhóm, FastAPI nhận tin nhắn, lưu vào MongoDB rồi broadcast đến các người dùng trong cùng phòng. Nhờ vậy, tin nhắn mới được gửi tới các thành viên đang kết nối mà không cần liên tục hỏi Server. |
| 6. Giai đoạn 3 — Đóng kết nối | 01:16–01:31 | Avatar rời khỏi phòng; một Client biến mất khỏi sơ đồ. Danh sách **Online** được cập nhật. | Giai đoạn ba là đóng kết nối. Khi người dùng rời phòng, kết nối được đóng và Server cập nhật danh sách người đang online, để các thành viên còn lại thấy trạng thái mới. |
| 7. Công cụ AI hỗ trợ | 01:31–01:43 | Hiện tên **ChatGPT** và **Gemini** dưới dạng nhãn đồ họa đơn giản; nền là tài liệu và đoạn mã minh họa. | Trong quá trình thực hiện, nhóm có sử dụng ChatGPT và Gemini để hỗ trợ tìm hiểu RFC 6455, tham khảo cách triển khai và hỗ trợ viết mã FastAPI, WebSocket. |
| 8. Chuyển sang demo và kết thúc | 01:43–01:55 | Avatar mời khán giả theo dõi. Tiêu đề: **Demo sản phẩm**. Kết màn hình bằng **Xin cảm ơn!** | Sau đây, xin mời thầy và các bạn cùng xem phần demo thực tế sản phẩm. Nhóm chúng em xin cảm ơn thầy và các bạn đã lắng nghe! |

## Bản lời thoại liên tục

Xin kính chào thầy và toàn thể các bạn! Hôm nay, nhóm chúng em xin trình bày bài tập nhóm số 2 với đề tài: Minh họa giao thức HTTP và WebSocket trong ứng dụng Chat Realtime MVP.

Đầu tiên là giao thức HTTP truyền thống. HTTP hoạt động theo cơ chế Request – Response: Client gửi yêu cầu, Server trả lời. Muốn nhận dữ liệu mới, Client thường phải gửi thêm yêu cầu. Việc này có thể gây độ trễ và tạo thêm lưu lượng do header được gửi lặp lại.

Để hỗ trợ trao đổi dữ liệu thời gian thực, nhóm chúng em sử dụng WebSocket. Kết nối WebSocket được thiết lập qua ba giai đoạn chính.

Giai đoạn một là Handshake. Client gửi HTTP request yêu cầu nâng cấp kết nối với header Upgrade: websocket. Nếu đồng ý, Server phản hồi mã 101 Switching Protocols để bắt đầu kết nối WebSocket.

Giai đoạn hai là truyền tin Full-Duplex: hai phía có thể gửi dữ liệu qua lại trên cùng kết nối. Trong ứng dụng của nhóm, FastAPI nhận tin nhắn, lưu vào MongoDB rồi broadcast đến các người dùng trong cùng phòng. Nhờ vậy, tin nhắn mới được gửi tới các thành viên đang kết nối mà không cần liên tục hỏi Server.

Giai đoạn ba là đóng kết nối. Khi người dùng rời phòng, kết nối được đóng và Server cập nhật danh sách người đang online, để các thành viên còn lại thấy trạng thái mới.

Trong quá trình thực hiện, nhóm có sử dụng ChatGPT và Gemini để hỗ trợ tìm hiểu RFC 6455, tham khảo cách triển khai và hỗ trợ viết mã FastAPI, WebSocket.

Sau đây, xin mời thầy và các bạn cùng xem phần demo thực tế sản phẩm. Nhóm chúng em xin cảm ơn thầy và các bạn đã lắng nghe!

## Phụ đề SRT

```srt
1
00:00:00,000 --> 00:00:14,000
Xin kính chào thầy và toàn thể các bạn! Hôm nay, nhóm chúng em xin trình bày bài tập nhóm số 2 với đề tài: Minh họa giao thức HTTP và WebSocket trong ứng dụng Chat Realtime MVP.

2
00:00:14,000 --> 00:00:31,000
Đầu tiên là giao thức HTTP truyền thống. HTTP hoạt động theo cơ chế Request – Response: Client gửi yêu cầu, Server trả lời. Muốn nhận dữ liệu mới, Client thường phải gửi thêm yêu cầu. Việc này có thể gây độ trễ và tạo thêm lưu lượng do header được gửi lặp lại.

3
00:00:31,000 --> 00:00:39,000
Để hỗ trợ trao đổi dữ liệu thời gian thực, nhóm chúng em sử dụng WebSocket. Kết nối WebSocket được thiết lập qua ba giai đoạn chính.

4
00:00:39,000 --> 00:00:53,000
Giai đoạn một là Handshake. Client gửi HTTP request yêu cầu nâng cấp kết nối với header Upgrade: websocket. Nếu đồng ý, Server phản hồi mã 101 Switching Protocols để bắt đầu kết nối WebSocket.

5
00:00:53,000 --> 00:01:16,000
Giai đoạn hai là truyền tin Full-Duplex: hai phía có thể gửi dữ liệu qua lại trên cùng kết nối. Trong ứng dụng của nhóm, FastAPI nhận tin nhắn, lưu vào MongoDB rồi broadcast đến các người dùng trong cùng phòng. Nhờ vậy, tin nhắn mới được gửi tới các thành viên đang kết nối mà không cần liên tục hỏi Server.

6
00:01:16,000 --> 00:01:31,000
Giai đoạn ba là đóng kết nối. Khi người dùng rời phòng, kết nối được đóng và Server cập nhật danh sách người đang online, để các thành viên còn lại thấy trạng thái mới.

7
00:01:31,000 --> 00:01:43,000
Trong quá trình thực hiện, nhóm có sử dụng ChatGPT và Gemini để hỗ trợ tìm hiểu RFC 6455, tham khảo cách triển khai và hỗ trợ viết mã FastAPI, WebSocket.

8
00:01:43,000 --> 00:01:55,000
Sau đây, xin mời thầy và các bạn cùng xem phần demo thực tế sản phẩm. Nhóm chúng em xin cảm ơn thầy và các bạn đã lắng nghe!
```

## Prompt tạo video avatar AI

Tạo video thuyết trình tiếng Việt tỉ lệ 16:9, phong cách đồ án đại học hiện đại và chuyên nghiệp. Dùng một avatar sinh viên Việt Nam trưởng thành, trang phục lịch sự, biểu cảm thân thiện, giọng đọc tiếng Việt tự nhiên, rõ chữ, tốc độ vừa phải. Giữ ngoại hình, trang phục, ánh sáng và chất giọng của avatar nhất quán ở mọi cảnh. Avatar đứng lệch bên trái hoặc bên phải tùy sơ đồ để không che nội dung. Dùng nền sáng, màu xanh dương và trắng, chuyển cảnh nhẹ nhàng. Minh họa bằng sơ đồ vector đơn giản, dễ đọc: Client, Server, HTTP Request/Response, WebSocket Handshake, mã 101 Switching Protocols, kết nối Full-Duplex, FastAPI, MongoDB, Broadcast và danh sách Online. Không tự tạo chữ dài, logo giả, mã nguồn khó đọc hoặc nhãn sai chính tả trong hình; chừa khoảng trống để chèn tiêu đề và phụ đề chính xác khi dựng. Đồng bộ khẩu hình với lời thoại tiếng Việt. Không thêm lời dẫn mới ngoài kịch bản. Kết thúc bằng màn hình “Demo sản phẩm” và “Xin cảm ơn!”.

## Lưu ý trước khi xuất bản

- Thay “nhóm chúng em” bằng tên nhóm hoặc tên người thuyết trình nếu cần.
- Kiểm tra lại cách công cụ avatar phát âm các từ **HTTP**, **WebSocket**, **FastAPI**, **MongoDB**, **Full-Duplex**, **Handshake**, **Broadcast** và **RFC 6455**; có thể thu âm lại các câu khó phát âm.
- Thời lượng trên là ước tính. Nếu công cụ đọc chậm hoặc nhanh, hãy điều chỉnh mốc cảnh và thời gian trong SRT sau khi tạo giọng đọc.
- Ở phần giải thích HTTP, cách diễn đạt dùng “thường phải gửi thêm yêu cầu” và “có thể gây độ trễ” để tránh khẳng định rằng mọi ứng dụng HTTP đều phải polling hoặc luôn lãng phí băng thông.
