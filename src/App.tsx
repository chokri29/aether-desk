import { useEffect, useState } from "react";
import { Desk } from "./components/Desk";
import { useDesk } from "./lib/store";

export default function App() {
  const hydrate = useDesk((s) => s.hydrate);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    void useDesk.persist.rehydrate().then(() => {
      hydrate();
      setReady(true);
    });
  }, [hydrate]);

  if (!ready) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-bg text-muted">
        <p className="text-sm tracking-wide">Loading desk…</p>
      </div>
    );
  }

  return <Desk />;
}
