'use client';

import React from 'react';
import WindowControls from './WindowControls';

/**
 * Khung tổng app:
 * - app-chrome: thanh khung chính (kéo cửa sổ + 3 nút OS)
 * - app-work-surface: cửa sổ làm việc (Header tool + sidebar + content)
 */
export default function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="app-viewport">
      <div className="app-frame" data-app-shell>
        {/* Title bar OS — chỉ dải drag + 3 nút; không che work surface */}
        <div className="app-chrome" data-app-chrome>
          <div className="app-chrome-drag" aria-hidden />
          <WindowControls />
        </div>
        {/* Header / sidebar / content — no-drag + pointer-events (CSS) */}
        <div className="app-work-surface" data-app-work>
          {children}
        </div>
      </div>
    </div>
  );
}
