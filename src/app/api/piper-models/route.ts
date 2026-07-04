import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export async function GET() {
  try {
    const piperDir = path.join(process.cwd(), 'bin', 'piper_vn');
    if (!fs.existsSync(piperDir)) {
      return NextResponse.json({ models: [] });
    }

    const files = fs.readdirSync(piperDir);
    const models = files
      .filter(f => f.endsWith('.onnx'))
      .map(f => {
        let name = f.replace('.onnx', '');
        name = name.charAt(0).toUpperCase() + name.slice(1);
        
        if (f === 'ngochuyen.onnx') name = 'Ngọc Huyền (Nữ)';
        if (f === 'manhdung.onnx') name = 'Mạnh Dũng (Nam)';
        
        return {
          id: f,
          name: name
        };
      });

    return NextResponse.json({ models });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
