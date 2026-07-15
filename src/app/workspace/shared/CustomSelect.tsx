import React, { useState, useRef, useEffect } from 'react';
import { Minus } from 'lucide-react';

export interface Option {
  value: string;
  label: string;
}

interface CustomSelectProps {
  options: Option[];
  value: string;
  onChange: (val: string) => void;
  disabled?: boolean;
  className?: string;
  dropdownClassName?: string;
}

export default function CustomSelect({ options, value, onChange, disabled, className = '', dropdownClassName = '' }: CustomSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const selectRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (selectRef.current && !selectRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const selectedOption = options.find(o => o.value === value) || options[0];

  return (
    <div className={`relative ${className}`} ref={selectRef}>
      <div 
        className={`flex items-center justify-between border border-[#ff7b00] rounded px-2 py-1 bg-black cursor-pointer ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
        onClick={() => !disabled && setIsOpen(!isOpen)}
      >
        <span className="text-[#ff7b00] font-bold text-sm truncate mr-2">{selectedOption?.label}</span>
        <div className="text-[#ff7b00]">
          <Minus className="h-4 w-4" strokeWidth={4} />
        </div>
      </div>

      {isOpen && (
        <div className={`absolute z-50 top-full left-0 mt-1 w-full bg-[#0a0a0a] border border-[#ff7b00] rounded overflow-hidden shadow-xl ${dropdownClassName}`}>
          <div className="max-h-60 overflow-y-auto custom-scrollbar">
            {options.map((option) => (
              <div
                key={option.value}
                className={`px-3 py-1.5 cursor-pointer font-bold text-sm transition-colors ${
                  value === option.value ? 'bg-[#0f2b4d] text-[#ff7b00]' : 'text-[#ff7b00] hover:bg-[#0f2b4d]'
                }`}
                onClick={() => {
                  onChange(option.value);
                  setIsOpen(false);
                }}
              >
                {option.label}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
