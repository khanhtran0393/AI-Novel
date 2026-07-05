/**
 * Module cấu hình âm thanh và thông báo cho hệ thống
 * Tuân thủ kiến trúc Báo động không giám sát (Unattended Notification)
 */

export async function sendNotification(title: string, body: string, playSound: boolean = true) {
  // 1. Gửi thông báo Notification API
  if ('Notification' in window) {
    if (Notification.permission === 'granted') {
      new Notification(title, { body, icon: '/favicon.ico' });
    } else if (Notification.permission !== 'denied') {
      const permission = await Notification.requestPermission();
      if (permission === 'granted') {
        new Notification(title, { body, icon: '/favicon.ico' });
      }
    }
  }

  // 2. Phát âm thanh cảnh báo (Bíp)
  if (playSound) {
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const oscillator = audioCtx.createOscillator();
      const gainNode = audioCtx.createGain();
      
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(880, audioCtx.currentTime); // A5 note
      oscillator.frequency.exponentialRampToValueAtTime(440, audioCtx.currentTime + 0.5); // Drop to A4
      
      gainNode.gain.setValueAtTime(0.5, audioCtx.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.5);
      
      oscillator.connect(gainNode);
      gainNode.connect(audioCtx.destination);
      
      oscillator.start();
      oscillator.stop(audioCtx.currentTime + 0.5);
    } catch (e) {
      console.error('Lỗi khi phát âm thanh cảnh báo:', e);
    }
  }
}
