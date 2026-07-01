// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require('fs');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require('path');
const filePath = path.join(__dirname, '../src/app/workspace/page.tsx');
let content = fs.readFileSync(filePath, 'utf8');

content = content.replace(/\r\n/g, '\n');

// Locate start and end of damaged Google Drive header segment
const startMarker = "{/* 1. NÚT GOOGLE DRIVE MANAGER */}";
const endMarker = "{/* User Profile */}";

const startIdx = content.indexOf(startMarker);
const endIdx = content.indexOf(endMarker);

if (startIdx !== -1 && endIdx !== -1) {
  console.log(`SUCCESS: Found markers. startIdx: ${startIdx}, endIdx: ${endIdx}`);
  
  const targetReplace = content.substring(startIdx, endIdx);
  
  const cleanHeaderBlock = `{/* 1. NÚT GOOGLE DRIVE MANAGER */}
          <div className="relative">
            <button
              onClick={() => {
                setShowDriveManager(!showDriveManager);
                setShowApiKeyManager(false);
                setShowCookieManager(false);
              }}
              className={\`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider transition-all duration-300 border cursor-pointer \${
                store.googleLoggedIn
                  ? 'bg-emerald-950/40 text-emerald-400 border-emerald-800 hover:bg-emerald-900/30'
                  : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:bg-zinc-800'
              }\`}
            >
              <span className="flex items-center gap-1.5">
                {store.googleLoggedIn ? (
                  <>
                    <img src={store.googleUser?.avatar} className="h-3.5 w-3.5 rounded-full border border-emerald-500" />
                    <span>{store.googleUser?.name}</span>
                  </>
                ) : (
                  <span>💾 Google Drive</span>
                )}
              </span>
              <ChevronDown className="h-3 w-3 opacity-60" />
            </button>

            {showDriveManager && (
              <div className="absolute right-0 mt-2 w-80 rounded-xl border border-zinc-800 bg-zinc-950 p-4 shadow-2xl z-50 animate-in fade-in slide-in-from-top-2 duration-200">
                <div className="mb-3 flex items-center justify-between font-sans">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-emerald-400 flex items-center gap-1">
                    💾 Đồng Bộ Google Drive
                  </h3>
                  {store.googleLoggedIn && (
                    <span className="rounded bg-emerald-950 px-2 py-0.5 text-[8px] font-bold text-emerald-400 border border-emerald-850">
                      CONNECTED
                    </span>
                  )}
                </div>

                <div className="space-y-3 font-sans text-xs">
                  {!store.googleLoggedIn ? (
                    <div className="py-2.5 text-center flex flex-col items-center gap-3">
                      <p className="text-[10px] text-zinc-550 leading-relaxed">
                        Bạn chưa liên kết tài khoản Google Drive để tự động đồng bộ hóa tệp âm thanh (TTS), hình ảnh (Whisk) và storyboard video.
                      </p>
                      <button
                        onClick={() => {
                          setShowDriveManager(false);
                          setShowGoogleLoginDialog(true);
                        }}
                        className="w-full flex items-center justify-center gap-2 rounded-lg bg-white text-zinc-950 border border-zinc-255 py-2.5 text-[10px] font-bold uppercase tracking-wider transition-all hover:bg-zinc-200 cursor-pointer font-sans shadow-md"
                      >
                        <span className="font-extrabold flex items-center gap-0.5">
                          <span className="text-blue-600">G</span>
                          <span className="text-red-500">o</span>
                          <span className="text-yellow-500">o</span>
                          <span className="text-blue-600">g</span>
                          <span className="text-green-500">l</span>
                          <span className="text-red-500">e</span>
                        </span>
                        Đăng Nhập Bằng Google
                      </button>
                    </div>
                  ) : (
                    <>
                      `;
                      
  content = content.replace(targetReplace, cleanHeaderBlock);
  fs.writeFileSync(filePath, content, 'utf8');
  console.log('SUCCESS: Pushed replacement for damaged header area!');
} else {
  console.log(`ERROR: Could not locate markers in file! startIdx: ${startIdx}, endIdx: ${endIdx}`);
}
