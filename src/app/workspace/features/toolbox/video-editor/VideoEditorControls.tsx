'use client';

import React from 'react';

export function CustomCheckbox({
  checked,
  onChange,
  label,
  className = '',
}: {
  checked: boolean;
  onChange: (val: boolean) => void;
  label: string;
  className?: string;
}) {
  return (
    <label className={`flex items-center gap-2 cursor-pointer select-none ${className}`}>
      <input
        type="checkbox"
        className="hidden"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <div
        className={`w-[16px] h-[16px] rounded flex items-center justify-center border transition-colors ${
          checked ? 'bg-orange-500 border-orange-500' : 'border-slate-500 bg-slate-950'
        }`}
      >
        {checked && <div className="w-2 h-2 bg-black rounded-sm" />}
      </div>
      <span className="text-[11px] font-medium text-slate-200">{label}</span>
    </label>
  );
}

export function OrangeTab({
  active,
  children,
  onClick,
}: {
  active?: boolean;
  children: React.ReactNode;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 py-1 rounded text-center text-[10px] font-bold border transition-colors ${
        active
          ? 'bg-orange-500 border-orange-500 text-black'
          : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700'
      }`}
    >
      {children}
    </button>
  );
}
