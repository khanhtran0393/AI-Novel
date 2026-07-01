import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  try {
    const { apiKey } = await req.json();

    if (!apiKey) {
      return NextResponse.json(
        { valid: false, error: 'Thiếu API Key.' },
        { status: 400 }
      );
    }

    // Call a fast and lightweight endpoint to check the key
    // Hỗ trợ kiểm thử nhiều model linh hoạt trên cả v1 và v1beta
    const models = ['gemini-2.0-flash', 'gemini-1.5-flash'];
    let lastError = 'Không thể tìm thấy mô hình Flash nào hoạt động.';
    let status = 400;

    for (const model of models) {
      // 1. Thử gọi trên v1
      const url = `https://generativelanguage.googleapis.com/v1/models/${model}?key=${apiKey}`;
      try {
        const response = await fetch(url, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        });

        if (response.ok) {
          const data = await response.json();
          return NextResponse.json({
            valid: true,
            model: data.name || model,
          });
        }

        const errorData = await response.json().catch(() => ({}));
        const errMsg = errorData.error?.message || '';
        status = response.status;

        // Nếu model không được tìm thấy ở v1, thử với v1beta
        if (status === 404 || errMsg.includes('not found') || errMsg.includes('not supported')) {
          const urlBeta = `https://generativelanguage.googleapis.com/v1beta/models/${model}?key=${apiKey}`;
          const responseBeta = await fetch(urlBeta, {
            method: 'GET',
            headers: {
              'Content-Type': 'application/json',
            },
          });

          if (responseBeta.ok) {
            const dataBeta = await responseBeta.json();
            return NextResponse.json({
              valid: true,
              model: dataBeta.name || `${model} (v1beta)`,
            });
          }
          
          const errorDataBeta = await responseBeta.json().catch(() => ({}));
          lastError = errorDataBeta.error?.message || errMsg;
          status = responseBeta.status;
        } else {
          lastError = errMsg;
        }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } catch (err: any) {
        lastError = err.message || 'Lỗi kết nối';
        status = 500;
      }
    }

    return NextResponse.json({
      valid: false,
      error: lastError,
      status,
    });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    console.error('Lỗi khi kiểm tra API Key:', err);
    return NextResponse.json(
      { valid: false, error: err.message || 'Có lỗi xảy ra khi gọi API.' },
      { status: 500 }
    );
  }
}
