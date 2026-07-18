import os
import sys
import time
import json
import uuid
import hmac
import hashlib
import base64
import argparse
from datetime import datetime, timedelta

# Định chế 5 Năng lực của Dev & Zero-Trust Shield
# 1. Load Secret từ biến môi trường
SECRET_KEY = os.environ.get("COMPANY_SUPER_SECRET_KEY", "ainovel-enterprise-commercial-secret-key-2026")

REVOKE_FILE = "revoked_keys.json"
AUDIT_FILE = "audit_license.log"

def log_audit(action, details):
    with open(AUDIT_FILE, "a", encoding="utf-8") as f:
        f.write(f"[{datetime.now().isoformat()}] {action}: {details}\n")

def get_hwid():
    """Giả lập lấy Hardware ID cơ bản (có thể thay bằng mã WMI phức tạp hơn)"""
    import platform
    hwid_base = f"{platform.node()}-{platform.processor()}-{platform.system()}"
    return hashlib.sha256(hwid_base.encode('utf-8')).hexdigest()[:16]

def sign_data(data_str):
    return base64.urlsafe_b64encode(
        hmac.new(SECRET_KEY.encode(), data_str.encode(), hashlib.sha256).digest()
    ).decode().rstrip("=")

def generate_key(user, days, bind_hardware=False):
    exp_date = int(time.time()) + (days * 86400)
    
    payload = {
        "iss": "AINovel_Enterprise",
        "user": user,
        "exp": exp_date,
        "is_pro": True,
        "is_vip": True
    }
    
    if bind_hardware:
        payload["hwid"] = get_hwid()
        
    payload_b64 = base64.urlsafe_b64encode(json.dumps(payload).encode()).decode().rstrip("=")
    signature = sign_data(payload_b64)
    
    token = f"{payload_b64}.{signature}"
    log_audit("GENERATE", f"User: {user}, Days: {days}, HWID_Bound: {bind_hardware}, Token: {token[:15]}...")
    return token

def verify_key(token, ignore_hwid=False):
    # Load Blacklist
    if os.path.exists(REVOKE_FILE):
        with open(REVOKE_FILE, "r") as f:
            revoked = json.load(f)
            if token in revoked:
                print("❌ LỖI: Mã kích hoạt đã bị THU HỒI (Blacklisted)!")
                log_audit("VERIFY_FAILED", f"Token {token[:15]} is revoked.")
                return False

    try:
        payload_b64, signature = token.split('.')
        expected_sig = sign_data(payload_b64)
        
        if not hmac.compare_digest(signature, expected_sig):
            print("❌ LỖI: Chữ ký số không hợp lệ. Mã đã bị giả mạo!")
            log_audit("VERIFY_FAILED", f"Invalid signature for {token[:15]}")
            return False
            
        payload = json.loads(base64.urlsafe_b64decode(payload_b64 + "==").decode())
        
        current_time = int(time.time())
        exp_time = payload.get("exp", 0)
        
        # Grace Period (3 ngày ân hạn)
        grace_period = 3 * 86400
        
        if current_time > exp_time + grace_period:
            print(f"❌ LỖI: Mã đã hết hạn và vượt quá thời gian ân hạn!")
            log_audit("VERIFY_FAILED", f"Expired token {token[:15]}")
            return False
        elif current_time > exp_time:
            print(f"⚠️ CẢNH BÁO: Mã đã hết hạn nhưng đang trong thời gian Ân hạn 3 ngày!")
            
        if "hwid" in payload and not ignore_hwid:
            current_hwid = get_hwid()
            if payload["hwid"] != current_hwid:
                print(f"❌ LỖI: Mã kích hoạt này bị khóa cứng với máy tính khác (HWID mismatch)!")
                print(f"HWID Mã: {payload['hwid']} | HWID Máy này: {current_hwid}")
                log_audit("VERIFY_FAILED", f"HWID Mismatch. Token HWID: {payload['hwid']}")
                return False

        print("✅ Xác thực thành công! Quyền Pro/VIP đã được cấp.")
        log_audit("VERIFY_SUCCESS", f"Token {token[:15]} verified successfully.")
        return True
    except Exception as e:
        print(f"❌ LỖI: Định dạng mã không hợp lệ! ({str(e)})")
        return False

def revoke_key(token, reason):
    revoked = {}
    if os.path.exists(REVOKE_FILE):
        with open(REVOKE_FILE, "r") as f:
            try:
                revoked = json.load(f)
            except:
                pass
                
    revoked[token] = {
        "reason": reason,
        "date": datetime.now().isoformat()
    }
    with open(REVOKE_FILE, "w") as f:
        json.dump(revoked, f, indent=4)
        
    print(f"✅ Đã thu hồi mã thành công. Lý do: {reason}")
    log_audit("REVOKE", f"Token {token[:15]} revoked. Reason: {reason}")

def main():
    parser = argparse.ArgumentParser(description="AI Novel - Enterprise Activation Code Manager")
    subparsers = parser.add_subparsers(dest="command")
    
    # Generate
    gen_p = subparsers.add_parser("generate", help="Tạo mã kích hoạt mới")
    gen_p.add_argument("--user", required=True, help="Tên khách hàng / người dùng")
    gen_p.add_argument("--days", type=int, default=30, help="Số ngày sử dụng")
    gen_p.add_argument("--bind-hardware", action="store_true", help="Khóa mã với Hardware ID của máy tính tạo mã")
    gen_p.add_argument("--out-file", help="Xuất mã ra file .lic")
    
    # Verify
    ver_p = subparsers.add_parser("verify", help="Xác thực mã kích hoạt")
    ver_p.add_argument("--file", help="File .lic chứa mã")
    ver_p.add_argument("--code", help="Chuỗi mã kích hoạt")
    ver_p.add_argument("--ignore-hwid", action="store_true", help="Bỏ qua check HWID (dùng cho debug)")
    
    # Revoke
    rev_p = subparsers.add_parser("revoke", help="Thu hồi mã (Blacklist)")
    rev_p.add_argument("--code", required=True, help="Mã cần thu hồi")
    rev_p.add_argument("--reason", required=True, help="Lý do thu hồi (vd: Refund)")
    
    # Audit
    aud_p = subparsers.add_parser("audit", help="Xem nhật ký thanh tra")
    aud_p.add_argument("--lines", type=int, default=10, help="Số dòng cuối cùng")
    
    args = parser.parse_args()
    
    if args.command == "generate":
        token = generate_key(args.user, args.days, args.bind_hardware)
        print(f"\n🔑 MÃ KÍCH HOẠT (Activation Code):\n{token}\n")
        if args.out_file:
            with open(args.out_file, "w") as f:
                f.write(token)
            print(f"💾 Đã xuất mã ra file: {args.out_file}")
            
    elif args.command == "verify":
        token = None
        if args.file and os.path.exists(args.file):
            with open(args.file, "r") as f:
                token = f.read().strip()
        elif args.code:
            token = args.code
            
        if not token:
            print("❌ Vui lòng cung cấp --code hoặc --file")
            sys.exit(1)
        verify_key(token, args.ignore_hwid)
        
    elif args.command == "revoke":
        revoke_key(args.code, args.reason)
        
    elif args.command == "audit":
        if os.path.exists(AUDIT_FILE):
            with open(AUDIT_FILE, "r", encoding="utf-8") as f:
                lines = f.readlines()
                print("--- AUDIT LOG ---")
                for line in lines[-args.lines:]:
                    print(line.strip())
        else:
            print("Chưa có dữ liệu Audit.")
    else:
        parser.print_help()

if __name__ == "__main__":
    main()
