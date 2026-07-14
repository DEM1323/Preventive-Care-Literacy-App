interface Props {
  children: React.ReactNode;
  className?: string;
}

export function Button({ children, className = '', ...props }: Props & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={`bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3 px-6 rounded-xl transition shadow-lg disabled:opacity-50 disabled:cursor-not-allowed ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
