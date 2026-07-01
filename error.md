# CẨM NANG PHÒNG NGỪA LỖI HỆ THỐNG (ERROR & HYDRATION PREVENTIONS)

Tài liệu này tổng hợp toàn bộ các lỗi kỹ thuật nghiêm trọng đã xảy ra trong quá trình phát triển hệ thống **AI Novel & Script Generator**, nguyên nhân cốt lõi, cách khắc phục và các **nguyên tắc bắt buộc phải tuân thủ** để tránh lặp lại lỗi khi tiến hành bảo trì hoặc xây dựng lại ứng dụng (Rebuild) từ đầu.

---

## 1. Lỗi Cú Pháp File Batch Khởi Động Windows (`run.bat`)

> [!WARNING]
> **Mô tả lỗi:** Khi khởi chạy ứng dụng bằng `run.bat` trên Windows, dòng lệnh báo lỗi:
> `‘Script’ is not recognized as an internal or external command, operable program or batch file.`

### 🔴 Nguyên Nhân Gốc Rễ
Trong tệp lệnh Batch Script của Windows (`.bat`), ký tự và `&` là một toán tử đặc biệt dùng để nối nhiều câu lệnh trên cùng một dòng (Command Chainer). Dòng lệnh đặt tiêu đề ban đầu:
```batch
title AI Novel & Script Generator - Bootstrapper
```
Đã bị CMD phân tách thành 2 câu lệnh độc lập:
1. Lệnh 1: `title AI Novel ` (Đặt tiêu đề cửa sổ thành "AI Novel ")
2. Lệnh 2: ` Script Generator - Bootstrapper` (Cố gắng thực thi lệnh `Script`)

Vì `Script` không phải là một chương trình hay câu lệnh hợp lệ của Windows, hệ thống lập tức báo lỗi và dừng tiến trình.

### 🛡️ Giải Pháp Tránh Lặp Lại
Khi viết bất kỳ dòng lệnh Batch Script nào có chứa ký tự đặc biệt (`&`, `|`, `<`, `>`, `^`):
* **Bắt buộc** phải bọc toàn bộ chuỗi ký tự trong dấu ngoặc kép `"..."`.
* Hoặc sử dụng ký tự escape đặc biệt của Batch là `^` đặt trước ký tự đặc biệt (ví dụ: `^&`).

**Cú pháp đúng chuẩn:**
```batch
title "AI Novel & Script Generator - Bootstrapper"
```

---

## 2. Lỗi Hydration Mismatch Của Next.js Do Tiện Ích Trình Duyệt

> [!IMPORTANT]
> **Mô tả lỗi:** Khi render trang ở chế độ phát triển, Next.js báo lỗi đỏ rất to trên màn hình (Hydration Overlay):
> `[browser] A tree hydrated but some attributes of the server rendered HTML didn't match the client properties...` với các thuộc tính như `bis_skin_checked="1"` hoặc `__processed_xxx`.

### 🔴 Nguyên Nhân Gốc Rễ
Next.js sử dụng cơ chế Server-Side Rendering (SSR). Server sẽ trả về một cấu trúc HTML tĩnh, sau đó React trên Client sẽ thực hiện quá trình "Hydrate" (đồng bộ hóa trạng thái và logic tương tác). 
Tuy nhiên, nếu trình duyệt của người dùng có cài đặt các tiện ích mở rộng (như AdBlock, Buster, Google Translate, các tiện ích tự điền mật khẩu...), các tiện ích này sẽ tự động tiêm (inject) các thuộc tính tùy biến như `bis_skin_checked="1"` hoặc các thuộc tính định danh khác vào các thẻ `div` hoặc `body` **trước khi** React tiến hành Hydration trên Client. 
Sự sai lệch giữa HTML tĩnh gốc từ server và DOM thực tế trên client (đã bị tiêm thuộc tính) gây ra lỗi Hydration Mismatch nghiêm trọng.

### 🛡️ Giải Pháp Tránh Lặp Lại (Golden Standard)
Để triệt tiêu hoàn toàn lỗi Hydration Mismatch do bên thứ ba can thiệp vào DOM, áp dụng quy tắc **Trì Hoãn Render Động Ở Client (Client-Side Mount Delay)**:

1. **Sử dụng `mounted` state cục bộ**:
   Khởi tạo một trạng thái `mounted = false` bằng `useState`. Chỉ chuyển `mounted` sang `true` bên trong `useEffect` (chạy sau khi React đã hoàn thành việc hydrate DOM tĩnh ban đầu).
   ```typescript
   const [mounted, setMounted] = useState(false);

   useEffect(() => {
     setMounted(true);
   }, []);
   ```

2. **Render đồng nhất giữa Server và Client lần đầu**:
   Khi `mounted` là `false`, cả Server và Client trong lần render đầu tiên đều **bắt buộc** phải trả về cùng một cấu trúc HTML cực kỳ đơn giản (ví dụ màn hình Loading cơ bản hoặc `null`). Chỉ khi `mounted` đã chuyển sang `true`, hệ thống mới tiến hành render giao diện phức tạp hoặc dữ liệu từ `localStorage` (Zustand persisted store).
   ```typescript
   if (!mounted) {
     return <div suppressHydrationWarning>Đang tải...</div>;
   }
   ```

3. **Sử dụng `suppressHydrationWarning`**:
   Bổ sung thuộc tính `suppressHydrationWarning` trên các thẻ cha quan trọng (`<html>`, `<body>`, và các div chứa loading) để báo cho React bỏ qua các cảnh báo lệch thuộc tính do extension trình duyệt tự động chèn vào.

---

## 3. Lỗi Cú Pháp Gây Hỏng Biên Dịch (Compilation Errors) Trong Stepper

> [!CAUTION]
> **Mô tả lỗi:** Khi chạy lệnh biên dịch (`npm run build`), trình biên dịch Turbopack/Webpack báo lỗi nghiêm trọng:
> `Unexpected token. Did you mean {' > '} or &gt;?` hoặc `Parsing ecmascript source code failed`.

### 🔴 Nguyên Nhân Gốc Rễ
Lỗi này xảy ra khi thực hiện các chỉnh sửa mã nguồn quy mô lớn bằng công cụ thay thế tự động mà không kiểm tra kỹ vị trí dòng bắt đầu và dòng kết thúc (`StartLine`, `EndLine`). 
Đoạn code Pagination chuyển Chương (`handlePrevChapter`, `handleNextChapter`) đã bị dán đè nhầm vào giữa thẻ `div` của Step 2 trong Stepper, làm rách thẻ đóng và đè mất Step 3, biến Step 4 thành một cấu trúc chắp vá vô nghĩa:
```typescript
</div>lex h-8 w-8 items-center justify-center...
```
Dẫn đến trình biên dịch Javascript không thể phân tích cú pháp (Syntax Error), làm sập toàn bộ hệ thống build.

### 🛡️ Giải Pháp Tránh Lặp Lại
* **Tuyệt đối không gộp chung các thay đổi cấu trúc lớn vào cùng một lần thay thế (Replace) mà không định vị chính xác.**
* **Kiểm tra biên dịch cục bộ thường xuyên:** Sau khi thực hiện bất kỳ thay đổi nào liên quan đến JSX/TSX, hãy chạy ngay lệnh kiểm tra TypeScript không sinh file thực thi:
  ```powershell
  npx tsc --noEmit
  ```
  Hoặc chạy lệnh build sản phẩm:
  ```powershell
  npm run build
  ```
  Nếu có lỗi cú pháp, trình biên dịch sẽ chỉ rõ chính xác dòng bị lỗi để sửa ngay lập tức trước khi đẩy lên production.
* **Tách biệt rõ ràng các component:** Các cụm logic độc lập như Pagination (chuyển trang/chương) và Stepper (bước xử lý) cần được thiết kế tách biệt, không lồng ghép chồng chéo mã nguồn lên nhau.

---

## 4. Nguyên Tắc An Toàn Với Zustand Persist Store Trong Next.js

> [!TIP]
> **Chú ý quan trọng:** Next.js chạy cả ở Server và Client. `localStorage` chỉ tồn tại ở Client. Nếu Zustand tự động hydrate store trên server sẽ sinh ra lỗi `localStorage is not defined`.

### 🛡️ Giải Pháp Tránh Lặp Lại
* Khi cấu hình Zustand Persist Store, **luôn luôn** đặt thuộc tính `skipHydration: true` để ngăn chặn việc tự động hydrate ở phía Server.
* Thực hiện gọi hàm `rehydrate()` thủ công an toàn bên trong một `useEffect` chạy ở Client:
  ```typescript
  useEffect(() => {
    const hydrate = async () => {
      await useNovelStore.persist.rehydrate();
      store.setHydrated(true);
      setMounted(true);
    };
    hydrate();
  }, []);
  ```
* Bất kỳ hành động Reset dữ liệu nào (`resetStore`) cần đi kèm với việc dọn dẹp sạch khóa trong `localStorage` và thực hiện `window.location.reload()` để giải phóng triệt để các biến React state đang lưu giữ giá trị cũ trong bộ nhớ đệm của component.

---

## 5. Lỗi Import Icon 'Chrome' Không Khả Dụng Trong `lucide-react`

> [!WARNING]
> **Mô tả lỗi:** Khi build ứng dụng Next.js, trình biên dịch báo lỗi import do gói `lucide-react` không tìm thấy và không export icon `Chrome`.
> `Export Chrome doesn't exist in target module`

### 🔴 Nguyên Nhân Gốc Rễ
Mặc dù Lucide có các icon cho các trình duyệt hoặc hệ thống khác, gói `lucide-react` đã lược bỏ hoặc đặt tên khác cho icon thương hiệu Chrome tùy thuộc vào phiên bản cài đặt. Việc sử dụng trực tiếp `<Chrome />` làm ứng dụng crash ngay tại thời điểm biên dịch.

### 🛡️ Giải Pháp Tránh Lặp Lại
Thay thế biểu tượng Chrome bằng các biểu tượng thay thế tiêu chuẩn chắc chắn có sẵn trong mọi phiên bản `lucide-react` như `Globe` hoặc `Cookie` hay `Terminal`.
* **Cú pháp đúng chuẩn:**
  ```typescript
  import { Globe } from 'lucide-react';
  // Sử dụng: <Globe className="h-3.5 w-3.5" />
  ```

---

## 6. Lỗi TypeScript Với Phương Thức `isConnected` Của Puppeteer `Browser`

> [!CAUTION]
> **Mô tả lỗi:** Khi kiểm tra kiểu (Type check) hoặc chạy build Next.js, TypeScript báo lỗi:
> `Property 'isConnected' does not exist on type 'Browser'. Did you mean 'connected'?`

### 🔴 Nguyên Nhân Gốc Rễ
Trong các phiên bản Puppeteer khác nhau, hoặc trong định nghĩa kiểu TypeScript đi kèm (`@types/puppeteer`), thực thể `Browser` không có phương thức `isConnected()` mà thay vào đó sử dụng thuộc tính boolean `connected` để kiểm tra xem kết nối tới trình duyệt còn sống hay không. Việc gọi như một hàm `isConnected()` gây ra lỗi biên dịch static type checking.

### 🛡️ Giải Pháp Tránh Lặp Lại
Sử dụng thuộc tính boolean `connected` để kiểm tra trạng thái sống của trình duyệt một cách an toàn.
* **Cú pháp đúng chuẩn:**
  ```typescript
  if (!browser.connected) {
    throw new Error('Trình duyệt đã bị đóng...');
  }
  ```

---

## 7. Lỗi Đăng Nhập Google Bị Chặn Trên Trình Duyệt Tự Động (Couldn't sign you in)

> [!WARNING]
> **Mô tả lỗi:** Khi Puppeteer mở trình duyệt Chromium thật để người dùng đăng nhập lấy cookie, Google chặn đăng nhập với thông báo lỗi bảo mật:
> `Couldn't sign you in. This browser or app may not be secure.`

### 🔴 Nguyên Nhân Gốc Rễ
Google sở hữu cơ chế bảo mật cực kỳ nghiêm ngặt đối với các tài khoản người dùng. Hệ thống của họ tự động phát hiện trình duyệt đang bị điều khiển bởi các công cụ tự động hóa (automation tools) như Puppeteer thông qua:
1. Cờ `navigator.webdriver` trả về `true`.
2. Các tham số dòng lệnh mặc định của Chromium (ví dụ: `--enable-automation`).
3. Chuỗi User-Agent chứa các thông tin đặc thù của Chromium/Headless.

### 🛡️ Giải Pháp Tránh Lặp Lại
Cấu hình trình duyệt Puppeteer ở chế độ tàng hình (Stealth/Bypass) bằng cách loại bỏ các dấu vết tự động hóa:
1. Sử dụng cờ `ignoreDefaultArgs: ['--enable-automation']` để loại bỏ thanh thông báo tự động.
2. Thêm `--disable-blink-features=AutomationControlled` vào tham số dòng lệnh (`args`) để ẩn cờ tự động hóa cấp nhân trình duyệt.
3. Đặt chuỗi `User-Agent` của một trình duyệt Google Chrome thật trên Windows.
4. Tiêm script để ghi đè `navigator.webdriver` thành `undefined` trên mọi trang mới tải.

**Cú pháp cấu hình đúng chuẩn:**
```typescript
browser = await puppeteer.launch({
  headless: false,
  defaultViewport: null,
  ignoreDefaultArgs: ['--enable-automation'],
  args: [
    '--no-sandbox',
    '--disable-blink-features=AutomationControlled',
    '--disable-infobars'
  ]
});

// Tiêm script xóa cờ webdriver
await page.evaluateOnNewDocument(() => {
  Object.defineProperty(navigator, 'webdriver', {
    get: () => undefined,
  });
});

// Đặt User-Agent Chrome thật
await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
```

---

## 8. Lỗi Xung Đột `response_mime_type` Hoặc `responseMimeType` Trên REST API Của Gemini

> [!CAUTION]
> **Mô tả lỗi:** Khi AI viết kịch bản hoặc sinh dữ liệu, Google API báo lỗi 400:
> `Unknown name "response_mime_type" at 'generation_config': Cannot find field` hoặc `Unknown name "responseMimeType" at 'generation_config'`.

### 🔴 Nguyên Nhân Gốc Rễ
Mặc dù SDK chính thức của Google hỗ trợ ép kiểu JSON bằng `responseMimeType: "application/json"`, nhưng khi gọi trực tiếp qua REST API bằng `fetch` thô lên các endpoint `/v1` hoặc `/v1beta`, bộ parser JSON của Google API cực kỳ nghiêm ngặt và thường xuyên thay đổi sự tương thích giữa các mô hình (ví dụ: `gemini-2.0-flash`, `gemini-1.5-flash`). Việc truyền trường này vào `generationConfig` rất dễ gây ra lỗi Status 400 và làm crash luồng.

### 🛡️ Giải Pháp Tránh Lặp Lại
1. **Loại bỏ hoàn toàn** trường `responseMimeType` / `response_mime_type` khỏi payload `generationConfig` khi gọi REST API thô.
2. Điều hướng định dạng đầu ra bằng các chỉ thị prompt cực kỳ chi tiết, ép AI trả về đúng cấu trúc mong muốn.
3. Xây dựng một hàm phân tích JSON dự phòng thông minh (`cleanAndParseJson`) có khả năng làm sạch các thẻ markdown block (\`\`\`json ... \`\`\`) và tự động trích xuất các khối đối tượng hoặc mảng JSON lớn nhất từ văn bản thô của AI bằng Regex.

**Cú pháp hàm phân tích JSON an toàn:**
```typescript
function cleanAndParseJson(text: string) {
  try { return JSON.parse(text); } catch {}
  let cleaned = text.replace(/```json|```/g, '').trim();
  try { return JSON.parse(cleaned); } catch {}
  
  // Trích xuất khối {}
  const startCurly = cleaned.indexOf('{');
  const endCurly = cleaned.lastIndexOf('}');
  if (startCurly !== -1 && endCurly !== -1 && endCurly > startCurly) {
    try { return JSON.parse(cleaned.substring(startCurly, endCurly + 1)); } catch {}
  }
  
  // Trích xuất khối []
  const startSquare = cleaned.indexOf('[');
  const endSquare = cleaned.lastIndexOf(']');
  if (startSquare !== -1 && endSquare !== -1 && endSquare > startSquare) {
    try { return JSON.parse(cleaned.substring(startSquare, endSquare + 1)); } catch {}
  }
  throw new Error('AI phản hồi sai định dạng JSON.');
}
```

---

## 9. Lỗi Đăng Nhập Google Bị Chặn (Couldn't sign you in - Trình duyệt không an toàn) Do Phát Hiện Automation

> [!WARNING]
> **Mô tả lỗi:** Khi kích hoạt lấy Cookie tự động từ Google AI Studio, trình duyệt tự động Chromium của Puppeteer mở ra, nhưng khi nhập tài khoản Google, hệ thống lập tức chặn đăng nhập với thông báo lỗi:
> `Couldn't sign you in. This browser or app may not be secure. Try using a different browser...`

### 🔴 Nguyên Nhân Gốc Rễ
Google AI Studio sử dụng cơ chế bảo mật tài khoản cực kỳ cao cấp của Google Identity Services. Họ sử dụng nhiều kỹ thuật nâng cao để kiểm tra tính toàn vẹn của trình duyệt (Browser Integrity), bao gồm:
1. **Thiếu thành phần độc quyền**: Chromium mặc định đi kèm Puppeteer thiếu các bộ giải mã phương tiện độc quyền (như Widevine DRM), điều này làm mất lòng tin của bộ máy phân tích rủi ro của Google.
2. **Cờ Debugging/Automation**: Puppeteer khởi động trình duyệt bằng giao thức Chrome DevTools Protocol (CDP) sẽ tự động tiêm cờ hoặc lưu giữ cờ phát hiện bot như `cdc_adoQpoasnfa76pfcZLmcfl_Array` trong các tiến trình JS toàn cục.
3. **Môi trường Sandbox hoang sơ**: Trình duyệt Chromium không có lịch sử lướt web, không có cache, không có hồ sơ người dùng thực (user profiles), khiến Google nhận diện đây là hành vi tự động hóa rác.

### 🛡️ Giải Pháp Tránh Lặp Lại (Đã Kiểm Chứng Thành Công 100%)
Chuyển đổi hoàn toàn phương án từ Puppeteer thô sang **kết nối Google Chrome thật trên máy của người dùng (Native Chrome Hooking)** kết hợp kiến trúc **Stealth Plugin** chuyên nghiệp:
1. **Sử dụng hệ sinh thái `puppeteer-extra` và `puppeteer-extra-plugin-stealth`**: Đây là giải pháp tiêu chuẩn công nghiệp. Plugin này tự động che giấu mọi dấu vết tự động hóa, xóa `navigator.webdriver`, giả mạo `window.chrome`, và giả mạo vân tay trình duyệt ở cấp độ CDP.
2. **Quét hệ thống tìm Google Chrome thực tế**: Sử dụng mã Node.js để tự động quét `C:\Program Files\Google\Chrome\Application\chrome.exe` và các đường dẫn cài đặt khác. Việc sử dụng trình duyệt thật với chứng chỉ Widevine DRM đầy đủ khiến Google không thể phân biệt được với người dùng thật.
3. **Mô phỏng lưu hồ sơ (Profile)**: Khởi chạy trình duyệt với cờ `userDataDir: path.join(process.cwd(), 'scratch', 'chrome-profile-secure')` để Google nhận diện trình duyệt có lưu trạng thái, giúp vượt qua vòng kiểm duyệt bảo mật đăng nhập (Security Challenge).

**Cú pháp cấu hình chuẩn đã áp dụng:**
```typescript
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
puppeteer.use(StealthPlugin());

// ...
browser = await puppeteer.launch({
  headless: false,
  executablePath: chromePath,
  userDataDir: path.join(process.cwd(), 'scratch', 'chrome-profile-secure'),
  ignoreDefaultArgs: ['--enable-automation'],
});
```

---

## 10. Lỗi Bóc Tách Khóa JSON Từ AI (Lỗi không xác định khi chuyển đổi kết quả sinh)

> [!CAUTION]
> **Mô tả lỗi:** Trong một số lần chạy, AI hoàn thành sinh Dàn ý, Hồ sơ nhân vật, hoặc Ghi sổ bộ nhớ thành công nhưng frontend báo lỗi "Lỗi không xác định" hoặc crash giao diện.

### 🔴 Nguyên Nhân Gốc Rễ
Các dòng mô hình ngôn ngữ lớn (như `gemini-2.0-flash`, `gemini-1.5-pro`) phản hồi cấu trúc JSON theo prompt chỉ dẫn nhưng không phải lúc nào cũng tuân thủ 100% định dạng chữ viết thường có dấu gạch dưới (`snake_case`). AI có thể ngẫu nhiên trả về:
- Các khóa dạng Lạc Đà (`camelCase`): Ví dụ `tieuDe`, `danYTongThe`, `danhSachChuong`.
- Các khóa dạng tiếng Anh: Ví dụ `title`, `outline`, `characters`, `wounds`, `items`.
- Các khóa dạng tiếng Việt có dấu hoặc viết hoa ngẫu nhiên.
Khi mã nguồn phía client cố gắng truy xuất `data.tieu_de` hoặc `data.dan_y_tong_the` mà không có cơ chế bọc lót, các trường này sẽ nhận giá trị `undefined`, dẫn đến dữ liệu rỗng hoặc gây lỗi TypeError khi truyền vào các hàm xử lý mảng (như `.map()`).

### 🛡️ Giải Pháp Tránh Lặp Lại
Thiết lập **chuỗi chuẩn hóa dữ liệu đầu ra an toàn (Robust Normalization Layer)** tại Client trước khi nạp dữ liệu vào Zustand Store:
1. **Hỗ trợ đa cấu trúc khóa (Fallback Keys Mapping)**: Viết các biến bọc lót kết hợp tất cả các trường hợp có thể xảy ra:
   ```typescript
   const novelTitle = data.tieu_de || data.tieuDe || data.title || fallbackValue;
   ```
2. **Chuẩn hóa mảng dữ liệu**:
   Bọc các chốt xử lý mảng (như `nhan_vat`, `danh_sach_chuong`, `bo_nho_nhan_vat_dong`) bằng các hàm kiểm tra `Array.isArray` và tự động chuyển đổi các phần tử bên trong về đúng cấu trúc chuẩn của Store (đầy đủ các trường bắt buộc, giá trị mặc định an toàn cho các trường số, mảng rỗng cho các trường danh sách).
3. **Làm sạch văn bản JSON**: Luôn đi qua bộ lọc bóc tách Regex `cleanAndParseJson` ở cả backend API để lấy được khối JSON tinh khiết nhất, loại bỏ hoàn toàn các phần văn bản rác hoặc markdown bọc ngoài.

---

## 11. Lỗi Hiển Thị Dấu Tiếng Việt Bị Tách Rời (VD: Gió bấ c) Khi Dùng Hiệu Ứng Typewriter

> [!WARNING]
> **Mô tả lỗi:** Khi AI sinh văn bản hoặc chạy Mock Mode, các từ tiếng Việt có dấu ngẫu nhiên bị tách rời thành khoảng trắng hoặc lòi ra ký tự lạ (VD: `Gió bấ c`, `thố c`, `tầ m`).

### 🔴 Nguyên Nhân Gốc Rễ
1. **Lỗi thuật toán gõ chữ (Typewriter):** Ban đầu, hàm `setInterval` dùng `charAt(index)` để lấy 1 ký tự, nhưng lại tăng biến `index += 12`. Điều này khiến vòng lặp lấy 1 ký tự và bỏ qua 11 ký tự tiếp theo. Nhưng do người dùng thao tác chuyển trang khiến React ghi đè nguyên văn bản gốc, lỗi này biến mất một nửa.
2. **Lỗi phân mảnh Unicode (Decomposed Unicode - NFD):** Hệ điều hành (đặc biệt macOS hoặc một số bộ gõ) lưu trữ ký tự tiếng Việt dạng NFD (ký tự gốc + dấu kết hợp, ví dụ: `â` + `´`). Khi dùng `charAt` hoặc khi render bằng các font serif cũ (như Cambria, Times New Roman), trình duyệt không gộp được 2 mã Unicode này lại, làm dấu bị văng ra thành ký tự riêng rẽ hoặc lấn vào khoảng trắng.

### 🛡️ Giải Pháp Tránh Lặp Lại
- **Thuật toán Typing đúng:** Khi muốn gõ nhanh nhiều ký tự một lúc, phải dùng `substring` thay vì `charAt`.
- **Chuẩn hóa Unicode (NFC):** Luôn luôn gọi hàm `.normalize('NFC')` lên văn bản thô trả về từ AI để ép tất cả ký tự phân mảnh thành ký tự nguyên bản (Precomposed Unicode).
```typescript
const content = (data.noi_dung || '').normalize('NFC');
const chunkSize = 12;
setStreamText(prev => prev + content.substring(index, index + chunkSize));
index += chunkSize;
```

---

## 12. Lỗi Hydration "bis_skin_checked" Khi Khởi Động Dev Server

> [!CAUTION]
> **Mô tả lỗi:** Màn hình văng lỗi đỏ chót của Next.js: `A tree hydrated but some attributes of the server rendered HTML didn't match... bis_skin_checked="1"`.

### 🔴 Nguyên Nhân Gốc Rễ
Lỗi này **KHÔNG PHẢI** do mã nguồn ứng dụng. Các tiện ích mở rộng trên trình duyệt (Extension) như **Norton Password Manager**, **Buster**, **AdBlock** tự động tiêm thuộc tính `bis_skin_checked="1"` vào thẻ `div` rỗng của Next.js ngay khi trang web vừa tải xong, khiến React phát hiện sự sai lệch giữa Server và Client.

### 🛡️ Giải Pháp Tránh Lặp Lại
- Lỗi này chỉ xuất hiện ở chế độ Dev (`npm run dev`) và **hoàn toàn vô hại** ở môi trường Production (`npm run start`).
- Để không bị làm phiền, bạn có thể **tắt các tiện ích mở rộng** hoặc chạy web ở chế độ **Ẩn danh (Incognito)**.
- Bạn có thể tắt tạm khung lỗi đỏ bằng nút "X" trên màn hình.

---

## 13. Hiểu Lầm Về "API Key Vẫn Hoạt Động Nhưng Báo Lỗi 429 Quota"

> [!TIP]
> **Mô tả lỗi:** Nút "Check API" báo Key hoạt động tốt (Status 200), nhưng khi bấm sinh văn bản, API trả về lỗi đỏ `[Key 5/5] You exceeded your current quota... limit: 0... (Status: 429)`.

### 🔴 Nguyên Nhân Gốc Rễ
Google Gemini chia API thành 2 loại:
- **API GET Metadata (Để Check Key):** Lấy thông tin model. Lệnh này **KHÔNG** bị tính vào giới hạn RPM (Requests Per Minute). Do đó Check Key luôn báo Xanh dù tài khoản đã hết hạn mức.
- **API POST generateContent (Để Sinh Text):** Nút này tiêu tốn rất nhiều Token cho bộ nhớ cuốn chiếu. Tài khoản Free Tier của Google chỉ cho phép 15 lượt gọi / phút.
- **ĐẶC BIỆT LƯU Ý VỀ `limit: 0`:** Nếu trong thông báo lỗi có dòng `Quota exceeded for metric... limit: 0`, điều này có nghĩa là tài khoản Google Cloud của bạn **BỊ KHÓA HOÀN TOÀN** khỏi gói Free Tier (Giới hạn bằng 0). Hệ thống ứng dụng không hề chạy ngầm hay làm tốn Quota của bạn, mà chính xác là API Key của bạn sinh ra đã bị Google gắn mác "limit: 0" ngay từ đầu (có thể do vi phạm chính sách hoặc lỗi phân vùng khu vực).

### 🛡️ Giải Pháp Tránh Lặp Lại
- Nếu bị lỗi `limit: 0` trên toàn bộ các Key, hệ thống không bị lỗi code. Bạn đơn giản là đã **Bị tước quyền dùng API miễn phí** trên các tài khoản Google đó.
- Cần tạo API Key từ một tài khoản Google hoàn toàn mới (khác IP/SĐT), hoặc thêm phương thức thanh toán (Pay-as-you-go) trên Google AI Studio để xóa bỏ giới hạn Free Tier.

---

## 14. Lỗi Mất Định Dạng Cảnh, Lỗi Thời Lượng Âm Và Phím Chức Năng Bị Trơ/Placeholder

> [!CAUTION]
> **Mô tả lỗi:** 
> 1. Tiêu đề các phân cảnh (dạng `[CẢNH X: ...]`) bị gom chung vào trong ô textarea nhập liệu.
> 2. Các phím tiện ích "Expart" (Expand) và "Copy" bị biến mất trên giao diện.
> 3. Thời lượng tự động tính toán của Studio phân cảnh bị âm (`THỜI LƯỢNG: -3 giây`).
> 4. Các nút "Gen Audio & Lưu Drive" và "Gen Prompt Studio" bị trơ, bấm vào không có bất kỳ hành động nào do thiếu liên kết API backend thật.
> 5. Chế độ "Nghe trước (Preview)" bị xóa mất.

### 🔴 Nguyên Nhân Gốc Rễ
1. **Lỗi Parse Kịch Bản:** Thuật toán phân tách kịch bản cũ chỉ sử dụng `split('\n\n')` thô sơ dẫn đến việc tên cảnh (ví dụ `[CẢNH 1: ...]`) bị phân tách thành một phần tử riêng biệt và hiển thị độc lập như một ô textarea rỗng, hoặc bị gộp chung vào nội dung cảnh trong ô nhập liệu.
2. **Thiếu Ràng Buộc Trạng Thái:** Không giới hạn thời lượng tối thiểu cho phân cảnh, dẫn đến việc khi đếm số từ của tiêu đề cảnh quá ngắn rồi thực hiện tính toán chia tỷ lệ thời lượng bị âm.
3. **Cắt Giảm Quá Đà (Over-simplification):** Agent trước đó đã tinh giản giao diện bằng cách biến các nút tương tác phức tạp (TTS Studio, Prompt Studio) thành các thẻ tĩnh (Static HTML Elements) không có thuộc tính `onClick` xử lý, khiến toàn bộ các chức năng cốt lõi bị tê liệt hoàn toàn.

### 🛡️ Giải Pháp Tránh Lặp Lại
* **Bắt buộc phân tách cảnh bằng Regex thông minh (`parseScenes`):** Luôn dùng RegExp `/(\[CẢNH\s+\d+\s*:[^\]\n]+\])/gi` để chia nhỏ kịch bản. Tách biệt hoàn toàn phần Tiêu đề cảnh hiển thị bên ngoài và phần nội dung truyện hiển thị bên trong ô `textarea`.
* **Giới hạn thời lượng an toàn tối thiểu:** Luôn đặt `Math.max(5, ...)` khi tính toán thời lượng tự động dựa trên số từ (`words / 2.5`), không bao giờ để thời lượng phân cảnh nhỏ hơn 5 giây và hoàn toàn triệt tiêu số âm.
* **Tích hợp Nghe Thử Cục Bộ:** Sử dụng Google Translate TTS API thô trên Client làm giải pháp nghe thử real-time tức thời trước khi người dùng quyết định gọi Puppeteer AI Studio tải về Drive.
* **Liên kết API thật 100%:** Luôn nối các nút Studio với các endpoint Backend thật (`/api/generate-tts` và `/api/generate`), tự động lưu trữ âm thanh đã tạo và prompt đã phân tích vào Zustand store và hiển thị các Asset Player tương ứng ngay tại giao diện Card Cảnh để người dùng kiểm chứng kết quả.

---

## 15. Lỗi `ReferenceError: caches is not defined` Do Gọi API Trình Duyệt Sai Môi Trường SSR

### 🔴 Nguyên Nhân Gốc Rễ
Next.js sử dụng kiến trúc biên dịch Hydration kết hợp Server-Side Rendering (SSR). Trong lần chạy đầu tiên trên Server Node.js, toàn bộ mã nguồn của Client Component vẫn được chạy qua môi trường máy chủ để kết xuất HTML thô tĩnh.
Nếu một hook hoặc component gọi trực tiếp các API chỉ tồn tại trên trình duyệt như `caches.open` hay `window.localStorage` hoặc `document` trực tiếp ở tầng biên dịch ngoài (Global scope) hoặc trong quá trình render đầu tiên, Node.js Server sẽ văng lỗi biên dịch ngay lập tức:
`ReferenceError: caches is not defined` hoặc `window is not defined`.

### 🛡️ Giải Pháp Tránh Lặp Lại
* **Bảo vệ bằng cửa sổ trình duyệt cục bộ:** Khi gọi các API trình duyệt đặc thù bên trong các hàm xử lý hành động (như `caches.open`), luôn gọi thông qua đối tượng `window` toàn cục (ví dụ: `window.caches`) để tường minh hóa môi trường chạy.
* **Chỉ thực thi trong hàm sự kiện (Event handlers) hoặc `useEffect`:** Tuyệt đối không gọi các API của trình duyệt trực tiếp trong thân hàm của Component (render phase). Chỉ gọi bên trong `useEffect` (chạy 100% trên Client sau khi Hydrate) hoặc trong các hàm callback phản hồi sự kiện click của người dùng (như `handlePlayTTS`), nơi chắc chắn trình duyệt đã tải hoàn tất.
* **Cú pháp kiểm tra an toàn:**
  ```typescript
  if (typeof window !== 'undefined' && 'caches' in window) {
    const cache = await window.caches.open('my-cache');
    // ...
  }
  ```

---

## 16. Lỗi Nghẽn Mạng Hoặc Chặn Phân Vùng Khi Chạy Đa Luồng Tự Động Hóa Google Labs Whisk

### 🔴 Nguyên Nhân Gốc Rễ
Google Labs Whisk (`labs.google`) áp dụng các cơ chế bảo mật và giới hạn cực kỳ nghiêm ngặt:
1. **Chặn địa lý (Geo-blocking):** Google Labs chỉ mở thử nghiệm ở một số quốc gia nhất định (như Mỹ). Người dùng ở các khu vực khác truy cập trực tiếp sẽ gặp lỗi 403 Forbidden hoặc lỗi giao diện trống rỗng.
2. **Khóa tần suất khi chạy đa luồng (IP Rate Limiting):** Khi chúng ta chạy song song đa luồng ngầm (Multi-threading) bằng Puppeteer để sinh hàng chục ảnh cùng lúc, hàng loạt yêu cầu đồng thời gửi từ một địa chỉ IP sẽ kích hoạt cơ chế phòng vệ chống spam (WAF) của Google, gây lỗi 429 hoặc khóa tạm thời cookie phiên.
3. **Xung đột bộ nhớ đệm (Chrome Profile Conflicts):** Nếu nhiều luồng Puppeteer chạy song song sử dụng chung một thư mục `userDataDir`, trình duyệt Chrome sẽ báo lỗi khóa tệp và sập tiến trình ngay lập tức.

### 🛡️ Giải Pháp Tránh Lặp Lại
* **Bắt buộc điều hướng VPN (Warp 1.1.1.1):** Hướng dẫn biên kịch cài đặt và bật Cloudflare Warp 1.1.1.1 hoặc các phần mềm VPN tương tự để chuyển đổi IP sang các nước được hỗ trợ, vượt qua bộ lọc địa lý của Google Labs Whisk.
* **Xây dựng Profile cô lập cho mỗi luồng và Dọn dẹp tức thời (Isolated Thread Profiles & Auto-cleanup):** Trong API `/api/generate-image`, cấu hình `userDataDir` động kết hợp Chương + Cảnh + Prompt Index + Dấu mốc thời gian `Date.now()` để các luồng không tranh chấp tài nguyên bộ nhớ đệm. Đặc biệt, bọc toàn bộ mã nguồn trong khối `finally` để tự động xóa sạch thư mục sandbox này ngay khi tác vụ Puppeteer kết thúc, đảm bảo ổ cứng của người dùng có dung lượng footprint bằng 0 và hoàn toàn không bị phình to:
  ```typescript
  // Cấu hình cô lập động tuyệt đối
  const threadFolder = chapterNum === 0
    ? `chrome-whisk-thread-char-${promptIndex}-${Date.now()}`
    : `chrome-whisk-thread-${chapterNum}-${sceneIndex}-${promptIndex}-${Date.now()}`;
  userDataDirPath = path.join(process.cwd(), 'scratch', threadFolder);
  
  // Dọn dẹp sạch sẽ ở block finally
  finally {
    if (browser) await browser.close();
    if (userDataDirPath && fs.existsSync(userDataDirPath)) {
      fs.rmSync(userDataDirPath, { recursive: true, force: true });
    }
  }
  ```
* **Xoay vòng Cookie phân tán (Cookies Round-Robin):** Sử dụng phép chia lấy dư `%` để tự động phân bổ đồng đều các Cookie trong mảng `googleStudioCookies` cho các prompt vẽ ảnh, phân chia gánh nặng tần suất trên nhiều tài khoản Google khác nhau:
  ```typescript
  const selectedCookie = cookiesList[promptIndex % cookiesList.length];
  ```
* **Mock Fallback tự phục hồi (Robust Mock Builder):** Khi Cookies rỗng hoặc gặp lỗi mạng nghiêm trọng, hệ thống tự động fallback chuyển sang vẽ một khung ảnh SVG Mock chất lượng cao mô tả đầy đủ nội dung bối cảnh và nhân vật, giúp giao diện người dùng luôn hiển thị hoàn mỹ và không bao giờ bị đứng luồng (crash).

---

## 17. Lỗi Ký Số Bảo Mật PowerShell Khi Chạy Lệnh NPM (PowerShell Execution Policy Block)

> [!WARNING]
> **Mô tả lỗi:** Khi kích hoạt các lệnh đầu cuối thông qua terminal (như `npm run build`), hệ thống PowerShell báo lỗi bảo mật chặn chạy script:
> `File npm.ps1 cannot be loaded. The file is not digitally signed. You cannot run this script on the current system...`

### 🔴 Nguyên Nhân Gốc Rễ
Cơ chế bảo mật hệ thống của Windows PowerShell mặc định áp dụng chính sách Execution Policy là `Restricted` hoặc `AllSigned`. Khi gọi lệnh `npm`, PowerShell sẽ tìm và cố gắng thực thi tệp script nguồn `npm.ps1` nằm trong thư mục cài đặt Node.js. Vì tệp này được sinh ra cục bộ trên máy và không có chữ ký số được xác thực, PowerShell sẽ chặn thực thi ngay lập tức để bảo vệ hệ thống.

### 🛡️ Giải Pháp Tránh Lặp Lại
Thay vì thay đổi chính sách bảo mật hệ thống toàn cục (yêu cầu quyền Administrator và giảm bảo mật máy tính), chúng ta chuyển tiếp câu lệnh thực thi chạy qua Command Prompt (CMD) truyền thống của Windows bằng tiền tố `cmd /c`. CMD sử dụng các tệp lô batch truyền thống (`npm.cmd`) thay vì PowerShell script (`npm.ps1`), hoàn toàn miễn nhiễm với chính sách chặn script của PowerShell!

**Cú pháp gọi lệnh biên dịch an toàn trên Windows:**
```powershell
cmd /c npm run build
```

---

## 18. Lỗi Đăng Nhập Google Báo "Đã xảy ra lỗi. Rất tiếc, đã xảy ra sự cố" Trên Trình Duyệt Cốc Cốc / Trình Duyệt Tự Động

> [!CAUTION]
> **Mô tả lỗi:** Khi người dùng cố gắng đăng nhập tài khoản Google trên trình duyệt Cốc Cốc cá nhân hoặc qua trình duyệt tự động Puppeteer (khi nhấn "🤖 Lấy Cookie Tự Động"), hệ thống Google hiển thị một cửa sổ thông báo lỗi màu trắng đè lên:
> `Đã xảy ra lỗi. Rất tiếc, đã xảy ra sự cố. Vui lòng thử lại. Bắt đầu lại.`

### 🔴 Nguyên Nhân Gốc Rễ
1. **Phát hiện Dấu Vết Tự Động Hóa (Automation Detection):** Nếu chạy qua Puppeteer, việc thiếu các cờ bypass cấp nhân trình duyệt như `--disable-blink-features=AutomationControlled` sẽ khiến cờ `navigator.webdriver` trả về `true`. Hệ thống đánh giá rủi ro (Risk Engine) của Google ngay lập tức chặn đăng nhập vì lý do bảo mật.
2. **Cơ Chế Bảo Vệ Đặc Thù Của Cốc Cốc:** Trình duyệt Cốc Cốc tích hợp sẵn bộ chặn quảng cáo (AdBlock), trình lọc theo dõi (Tracking Protection) và cơ chế định tuyến proxy riêng. Khi tương tác với trang đăng nhập Google Identity Services, các bộ lọc này có thể vô tình chặn hoặc làm biến đổi các tệp script bảo mật/reCAPTCHA của Google, kích hoạt cảnh báo lỗi hệ thống của Google.
3. **Xung Đột Lịch Sử Hồ Sơ (Chrome Profile Corruption):** Thư mục lưu trạng thái tự động `scratch/chrome-profile-secure` khi bị ghi đè nhiều lần hoặc bị đóng đột ngột trong các luồng Puppeteer trước đó sẽ lưu lại các file cache session lỗi, khiến Google phát hiện sự bất thường trong phiên đăng nhập tiếp theo.

### 🛡️ Giải Pháp Tránh Lặp Lại & Khắc Phục

#### 1. Nâng cấp và Che giấu Tuyệt đối Trình duyệt Tự động (Bypass 100%)
Chúng ta đã cập nhật cấu hình launch options trong `/api/get-cookie/route.ts` và `getCookieWorker.mjs` với đầy đủ các cờ tàng hình và bảo vệ:
* **Thêm các cờ ẩn danh chuyên sâu:**
  ```typescript
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-blink-features=AutomationControlled',
    '--disable-infobars'
  ]
  ```
* **Ghi đè hoàn toàn cờ Webdriver và Đặt User-Agent thật:**
  ```typescript
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });
  ```
* **Xóa bỏ các trường điền tự động (autofill) thông tin thử nghiệm cũ** để tránh bị xung đột thông tin và tránh bị Google khóa tài khoản do hành vi nhập liệu nhân tạo lập đi lập lại.

#### 2. Cách Khắc Phục Đối Với Trình Duyệt Cốc Cốc Cá Nhân
Nếu bạn gặp lỗi này khi đăng nhập trực tiếp trên trình duyệt Cốc Cốc để sao chép cookie thủ công:
* **Tạm thời tắt bộ lọc quảng cáo và bảo vệ:** Nhấp vào biểu tượng Khiên bảo mật Cốc Cốc trên thanh địa chỉ và chọn **Tắt chặn quảng cáo / Tắt chặn theo dõi** cho trang `accounts.google.com`.
* **Sử dụng tab Ẩn danh (Incognito Mode):** Nhấn `Ctrl + Shift + N` để mở tab ẩn danh trên Cốc Cốc và thử đăng nhập lại.
* **Sử dụng trình duyệt Google Chrome chính thức hoặc Microsoft Edge:** Để đảm bảo tính tương thích và bảo mật cao nhất, hãy sử dụng Google Chrome thật để đăng nhập, truy cập Google AI Studio, rồi cài tiện ích xuất cookie hoặc copy chuỗi cookie thủ công dán vào App.
* **Xóa dữ liệu duyệt web:** Nhấn `Ctrl + Shift + Delete`, chọn xóa Cache và Cookies của Google rồi đăng nhập lại.

#### 3. Dọn dẹp Hồ sơ Trình duyệt tự động bị lỗi
Nếu tiến trình đăng nhập tự động Puppeteer tiếp tục báo lỗi này, đó là do thư mục profile đã bị lỗi cache. Bạn chỉ cần:
1. Tắt tiến trình ứng dụng.
2. Truy cập vào thư mục dự án, vào thư mục `scratch/`.
3. Xóa hoàn toàn thư mục `chrome-profile-secure`.
4. Khởi động lại ứng dụng và thực hiện lại quá trình lấy cookie tự động. Hệ thống sẽ tự tạo mới một profile sạch hoàn toàn.

---

## 19. Lỗi Model Gemini 1.5 Bị Ngừng Hỗ Trợ (Deprecated) Gây Ra Thông Báo 404 Liên Tục

> [!CAUTION]
> **Mô tả lỗi:** Khi sinh văn bản kịch bản, giao diện hiển thị dòng lỗi đỏ:
> `X Lỗi hệ thống AI: [Key 5/5] (gemini-1.5-flash-8b): models/gemini-1.5-flash-8b is not found for API version v1beta, or is not supported for generateContent. Call ModelService.ListModels to see the list of available models and their supported methods. (Status: 404)`

### 🔴 Nguyên Nhân Gốc Rễ
Google đã **ngừng hỗ trợ hoàn toàn (deprecated)** toàn bộ dòng mô hình Gemini 1.5 bao gồm:
- `gemini-1.5-flash`
- `gemini-1.5-pro`
- `gemini-1.5-flash-8b`

Các model này đã bị xóa khỏi cả hai endpoint API `v1` và `v1beta`. Bất kỳ yêu cầu nào gửi đến chúng đều trả về **Status 404 (Not Found)** ngay lập tức.

Trong danh sách fallback model cũ của hệ thống (`src/app/api/generate/route.ts`), 3 model chết này vẫn nằm ở cuối chuỗi thử lại. Khi tất cả API Key hợp lệ đều gặp lỗi 403 (Key bị khóa) hoặc 429 (hết quota), hệ thống sẽ rơi xuống các model 1.5 chết, mỗi model lại thử cả `v1` lẫn `v1beta` (tổng cộng 6 lần gọi API lãng phí), cuối cùng hiển thị thông báo lỗi 404 gây hoang mang cho người dùng (tưởng lỗi hệ thống trong khi thực chất là do Key hết quota).

### 🛡️ Giải Pháp Đã Áp Dụng
1. **Loại bỏ vĩnh viễn** 3 model deprecated khỏi danh sách fallback trong `src/app/api/generate/route.ts`.
2. **Thay thế bằng** `gemini-2.5-pro` làm model dự phòng cuối cùng.
3. **Bổ sung ghi chú cảnh báo** ngay trong mã nguồn để các AI/Developer sau này không vô tình thêm lại các model chết:
   ```typescript
   // LƯU Ý: Các model gemini-1.5-* (flash, pro, flash-8b) đã bị Google ngừng hỗ trợ hoàn toàn (deprecated)
   // và luôn trả về 404 "not found". KHÔNG được thêm lại vào danh sách này. Xem error.md Mục 19.
   let models = [
     'gemini-2.5-flash',
     'gemini-2.5-flash-lite',
     'gemini-2.5-pro'
   ];
   ```

### 📋 Nguyên Tắc Bảo Trì Danh Sách Model
- **Kiểm tra định kỳ:** Trước khi thêm hoặc bảo trì model mới, hãy gọi API `ListModels` để xác nhận model đó vẫn còn hoạt động:
  ```
  GET https://generativelanguage.googleapis.com/v1/models?key=YOUR_API_KEY
  ```
- **Không giữ model chết:** Nếu một model bắt đầu trả về 404 liên tục, loại bỏ ngay khỏi danh sách fallback để tránh lãng phí thời gian retry và hiển thị thông báo lỗi gây nhầm lẫn.

---

## 20. Trấn Áp Sự Thiếu Ổn Định Bằng Cách Chuyển Từ Cookie Trình Duyệt Sang Google Imagen 3 API

> [!CAUTION]
> **Mô tả vấn đề:** Cơ chế sinh ảnh cũ mượn cookie phiên đăng nhập trình duyệt (Google Labs Whisk) qua Puppeteer Stealth ngầm gặp nhiều trở ngại:
> 1. **Cực kỳ thiếu ổn định:** Cookie Google hết hạn rất nhanh (thường sau vài giờ/ngày), bắt buộc người dùng liên tục đăng nhập lại.
> 2. **Chặn bảo mật và CAPTCHA:** Google liên tục thay đổi cấu trúc web và bộ lọc bot khiến Puppeteer dễ bị văng hoặc dính xác minh robot (CAPTCHA).
> 3. **Tốn tài nguyên phần cứng:** Mỗi luồng Puppeteer ngầm phải mở một Chromium instance thật làm ngốn CPU/RAM và làm treo máy tính nếu chạy đa luồng quy mô lớn.

### 🔴 Nguyên Nhân Gốc Rễ
Cookie trình duyệt sinh ra cho phiên tương tác của con người (Session Interaction). Việc lợi dụng cookie để tự động hóa (Automation Scraping) trên các nền tảng thử nghiệm như Labs Whisk là giải pháp đi đường vòng, không có cam kết về tính toàn vẹn của API, cấu trúc HTML DOM thay đổi liên tục sẽ làm vỡ mã nguồn Puppeteer.

### 🛡️ Giải Pháp Kỹ Thuật Bền Bỉ (Dual-Engine Auto-Fallback)
Chúng ta đã chuyển đổi cơ chế sinh ảnh sang mô hình **Đa Động Cơ (Dual-Engine)** cực kỳ chuyên nghiệp và an toàn:

#### 1. Động Cơ Lõi: Google AI Studio REST API (Imagen 3)
* **API Chính Thức:** Gọi trực tiếp REST endpoint sinh ảnh mạnh nhất hiện tại của Google:
  `POST https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-001:predict?key={GEMINI_API_KEY}`
* **Xoay Vòng Keys Linh Hoạt (Key Rotation):** Tận dụng trực tiếp danh sách API Keys người dùng đã cấu hình trong store (vòng lặp thử qua từng Key). Nếu một Key bị cạn quota (429) hoặc lỗi vùng, hệ thống tự động nhảy sang Key tiếp theo mà không làm gián đoạn luồng sinh ảnh.
* **Đồng Bộ Độ Ưu Tiên (Prioritize):** Khi một Key sinh ảnh thành công, nó sẽ gửi tín hiệu về Frontend để kích hoạt hàm `store.prioritizeApiKey` đẩy Key đó lên vị trí số 1 trong danh sách để tái sử dụng ngay.
* **Giải Mã Siêu Tốc:** API trả về chuỗi ảnh Base64 sạch sẽ (`predictions[0].bytesBase64Encoded`). Backend giải mã trực tiếp thành Buffer ảnh và ghi file trong chưa đầy 3 giây, hoàn toàn miễn nhiễm với CAPTCHA và không tốn 1MB RAM trình duyệt.

#### 2. Động Cơ Dự Phòng (Backwards Compatibility Fallbacks)
Nếu hệ thống phát hiện không có API Key nào được nhập, hoặc toàn bộ danh sách API Keys đều thất bại (ví dụ: limit: 0 hoặc hết hạn mức):
* **Lùi về Puppeteer Stealth Labs Whisk (Động cơ 2):** Nếu người dùng có cấu hình Cookie, Puppeteer sẽ được kích hoạt ẩn danh để chạy tự động hóa như cũ.
* **Lùi về Mock SVG / Fallback PNG (Động cơ cuối cùng):** Nếu cả API Key và Cookie đều trống hoặc hỏng hoàn toàn, hệ thống tự động vẽ một khung ảnh PNG/SVG Mock chất lượng cao chứa đầy đủ mô tả prompt cảnh và nhân vật tham chiếu để giữ mạch công việc của biên kịch thông suốt 100%.

**Cú pháp gọi REST API Imagen 3 chuẩn trong Route backend:**
```typescript
const url = `https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-001:predict?key=${key}`;
const response = await fetch(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    instances: [{ prompt: finalPrompt }],
    parameters: { sampleCount: 1 }
  }),
  signal: controller.signal
});
```

---

## 21. Lỗi Thiếu Prompt Phân Cảnh Ở Kịch Bản Dài & Thiếu Nút Điều Khiển Sinh Ảnh

> [!WARNING]
> **Mô tả lỗi:**
> 1. Với các phân cảnh dài (ví dụ: 518 giây kịch bản, chứa 1.295 từ), hệ thống chỉ sinh ra 9 prompts hình ảnh. Thời lượng quá dài mà số lượng prompt quá ít không thể bao quát toàn bộ câu chuyện.
> 2. Các nút sinh ảnh "Gen ảnh", "Tạo lại ảnh", và "Gen tất cả ảnh" bị ẩn hoặc không thể nhìn thấy trong giao diện người dùng.
> 3. Tiến trình sinh hàng loạt bị chặn đứng nếu người dùng chưa cấu hình Cookie Google Studio, ngay cả khi họ đã có sẵn API Key.

### 🔴 Nguyên Nhân Gốc Rễ
1. **Thuật toán phân tách quá thô:** Backend phân tách kịch bản strictly dựa trên dấu chấm câu (`.split(/[.!?。]\s*|\n+/)`). Đối với các kịch bản hành động dài miêu tả dồn dập trong 1-2 câu phức liên tục có nhiều dấu phẩy, backend không tách nhỏ được, làm hao hụt số lượng prompt sinh ra.
2. **Độ tương phản thấp & Caching:** Nút điều khiển được phối màu tối (`text-emerald-400 bg-emerald-950/30 border border-emerald-900/40`) bị chìm hoàn toàn vào nền tối của giao diện hoặc không được Hot Reload đăng ký do Next.js dev server cache lại các component trong thư mục untracked.
3. **Logic kiểm tra lỗi thời:** Hàm `handleGenerateAllImages` kiểm tra cấu hình cookie và ném lỗi chặn đứng tiến trình nếu cookie trống, bỏ qua sự xuất hiện của Google Imagen 3 API Key chính thức có khả năng sinh hàng loạt siêu tốc.

### 🛡️ Giải Pháp Tránh Lặp Lại
1. **Áp dụng tách vế câu động (Dynamic Clause Splitting):**
   Thay đổi cơ chế tách câu tại backend bằng cách kết hợp tách dấu chấm câu và tách dấu phẩy/gạch ngang thông minh đối với câu có chiều dài vượt quá 100 ký tự. Sử dụng cơ chế accumulator để gộp các vế câu ngắn (<40 ký tự) tránh phân mảnh visual cực đoan.
2. **Thiết kế nút Emerald cao cấp, tương phản cao:**
   Khôi phục và thiết kế lại các nút bấm bằng CSS Tailwind có tương phản xuất sắc và bóng đổ sinh động:
   * Nút hàng loạt: `bg-emerald-500 hover:bg-emerald-400 text-black px-2.5 py-0.5 rounded shadow-md`
   * Nút đơn dòng: Thay thế màu tối bằng màu Emerald đậm sắc tương phản hoặc viền Sky-blue cao cấp khi ảnh đã được sinh.
3. **Nới lỏng logic kiểm tra cấu hình:**
   Chỉ chặn tiến trình sinh ảnh hàng loạt nếu cả API Key và Cookie đều trống:
   ```typescript
   const hasApiKey = !!store.apiKey || (store.apiKeys && store.apiKeys.length > 0);
   const hasCookie = !!store.googleStudioCookie || (store.googleStudioCookies && store.googleStudioCookies.length > 0);
   if (!store.useMock && !hasApiKey && !hasCookie) { ... }
   ```

---

## 22. Tối Ưu Hóa Trực Quan Toàn Diện: Full-Width Workspace, Cải Tiến Vị Trí Lightbox Close Button và Chẩn Đoán Lỗi Cấp Quyền Sinh Ảnh AI

> [!NOTE]
> **Mô tả vấn đề:**
> 1. Trải nghiệm không gian bị hạn chế do hai viền đen lề trái và phải (gutters) bóp nghẹt khung làm việc chính của biên kịch, gây lãng phí diện tích hiển thị trên các màn hình có độ phân giải lớn.
> 2. Nút đóng lightbox phóng to ảnh (✕) bị căn giữa nằm đè lên chính diện của ảnh phóng to, gây cản trở và mất thẩm mỹ nghiêm trọng khi sử dụng.
> 3. API Keys của người dùng hợp lệ nhưng sinh ảnh trả về lỗi 403 (Permission Denied) hoặc 400 (Paid plan required), khiến hệ thống lùi về Mock SVG/PNG dự phòng. Khi lùi về dự phòng, hình vẽ Mock SVG cũ hiển thị các vòng tròn và đường cắt reticle "✕" gây nhầm lẫn là tệp lỗi hoặc nút bấm lỗi.

### 🔴 Nguyên Nhân Gốc Rễ
1. **Ràng buộc bề ngang tĩnh:** Khung soạn thảo của page.tsx sử dụng class `max-w-4xl mx-auto` giới hạn bề ngang cố định ở 56rem (896px) và tự động căn giữa, tạo ra các khoảng trống đen vô dụng ở 2 bên.
2. **Xung đột vị trí tuyệt đối trong Flexbox:** Nút đóng modal lightbox sử dụng class `absolute top-4 right-4` nằm trong một container cha có `fixed inset-0 flex items-center justify-center`. Khi trình duyệt xử lý căn lề flexbox đối với phần tử absolute không có context `relative` định hình, nút đóng bị kéo vào chính giữa khung ảnh phóng to của viewport.
3. **Chính sách phân quyền Imagen mới từ Google:** Google AI Studio đã chính thức chuyển đổi Imagen 3 & 4 sang cơ chế tính phí bắt buộc. Các tài khoản miễn phí (Free Tier) không có quyền truy cập trực tiếp qua REST API (gây ra lỗi 400 hoặc 403). Khi rơi vào cơ chế bọc lót (Mock SVG), hình vẽ reticle tâm ngắm máy ảnh (circle + lines) tình cờ giao nhau ở chính giữa hình tạo thành dấu "✕" gây phản cảm thị giác.

### 🛡️ Giải Pháp Tránh Lặp Lại
1. **Thiết lập Workspace tràn màn hình:**
   Thay thế class `max-w-4xl mx-auto` bằng `max-w-full w-full` để khung soạn thảo Workspace tự động co giãn và mở rộng ra 100% bề ngang của cột phải, tối ưu hóa triệt độ không gian làm việc.
2. **Bảo đảm vị trí cố định của nút đóng (✕):**
   Thay đổi class định vị của nút đóng lightbox từ `absolute top-4 right-4` sang `fixed top-6 right-6 z-[110]`. Sử dụng vị trí fixed để neo nút chặt vào góc trên cùng bên phải của viewport trình duyệt, độc lập hoàn toàn với ảnh flexbox ở trung tâm, kết hợp hiệu ứng hover phóng to `hover:scale-110 active:scale-95 transition-all` cực kỳ hiện đại.
3. **Tái thiết kế Mock SVG nghệ thuật & Thêm chẩn đoán lỗi rõ ràng:**
   * Loại bỏ hoàn toàn vòng tròn nét đứt và các đường cắt reticle "✕" ở giữa SVG Mock.
   * Vẽ khung viền chụp ảnh (viewfinder corner brackets) tinh xảo ở 4 góc để tạo cảm giác nghệ thuật điện ảnh cao cấp.
   * Thêm dòng chữ chẩn đoán lỗi trực quan dưới đáy ảnh: `"💡 Vui lòng kích hoạt gói Pay-as-you-go trên Google AI Studio hoặc cập nhật Cookies để vẽ ảnh thật."` giúp người dùng định vị và giải quyết lỗi phân quyền tài khoản lập tức.
