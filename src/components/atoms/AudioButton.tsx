interface Props {
  word: string;
  onSpeak: () => void;
}

export function AudioButton({ word, onSpeak }: Props) {
  return (
    <button
      type="button"
      onClick={onSpeak}
      className="bg-slate-100 hover:bg-emerald-50 hover:text-emerald-900 border border-slate-200 hover:border-emerald-300 px-3 py-1.5 rounded-xl text-xs font-semibold text-slate-700 transition flex items-center space-x-1.5"
      aria-label={`Listen to ${word}`}
    >
      <span>{word}</span>
      <i className="fa-solid fa-volume-low text-[10px] text-slate-400" />
    </button>
  );
}
