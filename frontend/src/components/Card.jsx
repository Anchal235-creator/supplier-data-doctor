export default function Card({ as: Component = 'section', className = '', ...props }) {
  return <Component className={`rounded-lg border border-slate-200/80 bg-white shadow-[0_10px_30px_rgba(15,23,42,0.045)] ${className}`} {...props} />
}
