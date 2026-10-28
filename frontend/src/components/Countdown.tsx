export function Countdown({ text }: { text: string }) {
  return (
    <div className="screen clear">
      {/* key: mỗi số mới mount lại để chạy lại hiệu ứng */}
      <div key={text} className="countdown" aria-live="assertive">
        {text}
      </div>
    </div>
  );
}
