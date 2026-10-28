// Hiển thị chuỗi có **chữ đậm** mà không cần dangerouslySetInnerHTML
export function Rich({ text }: { text: string }) {
  return text.split("**").map((part, i) => (i % 2 ? <b key={i}>{part}</b> : part));
}
