# Google Flow / browser automation — disclaimer

## Rủi ro

Tính năng **Flow Bridge** (điều khiển trình duyệt, cookie, multi-account, gen ảnh/video qua labs.google hoặc tương đương) là **công cụ kỹ thuật nâng cao**:

- Có thể **không được Google cho phép** theo ToS hiện hành.
- Có thể dẫn tới khóa tài khoản, captcha, mất credit.
- Phụ thuộc UI/API thay đổi bất kỳ lúc nào (B10: không fallback provider ngầm).

## Trách nhiệm

- **User / CISO** tự quyết định bật Flow, tự login, tự chịu rủi ro tài khoản.
- Nhà phát hành app **không** bảo hành Flow luôn hoạt động và **không** khuyến khích lách ToS.
- Chế độ thương mại khuyến nghị: ghi rõ “Advanced / at your own risk” trên trang bán.

## Giảm thiểu

- Dùng tài khoản test; không share cookie.
- Ưu tiên API chính thức khi có.
- Tắt multi-account nếu không cần.
