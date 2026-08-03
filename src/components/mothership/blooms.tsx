import { C } from "./style";

// The Mothership's ambient space ground — three soft radial blooms behind the
// content. One definition; deck, home, telemetry and future pages render it.
export function AmbientBlooms() {
  return (
    <div className="pointer-events-none fixed inset-0 z-[-1] overflow-hidden">
      <div className="absolute left-[-10%] top-[-10%] h-[40%] w-[40%] rounded-full blur-[120px]" style={{ background: `${C.purple}1a` }} />
      <div className="absolute bottom-[-10%] right-[-10%] h-[50%] w-[50%] rounded-full blur-[150px]" style={{ background: `${C.cyan}1a` }} />
      <div className="absolute right-[20%] top-[20%] h-[20%] w-[20%] rounded-full blur-[100px]" style={{ background: `${C.green}0d` }} />
    </div>
  );
}
