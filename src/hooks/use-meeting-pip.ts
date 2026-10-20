import { useCallback, useEffect, useState } from "react";

type DocumentPiP = {
  requestWindow: (opts: { width: number; height: number }) => Promise<Window>;
};

function copyStyles(target: Window) {
  const doc = target.document;
  document.querySelectorAll('style, link[rel="stylesheet"]').forEach((node) => {
    doc.head.appendChild(node.cloneNode(true));
  });
  doc.documentElement.className = document.documentElement.className;
  doc.documentElement.style.colorScheme = getComputedStyle(document.documentElement).colorScheme;
  doc.body.className = "bg-background text-foreground antialiased";
  doc.title = "Live transcript";
}

export function usePictureInPicture() {
  const [pipWindow, setPipWindow] = useState<Window | null>(null);

  const close = useCallback(() => {
    setPipWindow((win) => {
      if (win && !win.closed) win.close();
      return null;
    });
  }, []);

  const open = useCallback(async (): Promise<boolean> => {
    if (pipWindow && !pipWindow.closed) {
      pipWindow.focus();
      return true;
    }
    let win: Window | null = null;
    const docPip = (window as unknown as { documentPictureInPicture?: DocumentPiP })
      .documentPictureInPicture;
    try {
      if (docPip?.requestWindow) {
        win = await docPip.requestWindow({ width: 400, height: 560 });
      } else {
        win = window.open("", "meeting_live_overlay", "width=400,height=560,resizable=yes");
      }
    } catch {
      win = null;
    }
    if (!win) return false;
    copyStyles(win);
    win.addEventListener("pagehide", () => setPipWindow(null));
    setPipWindow(win);
    return true;
  }, [pipWindow]);

  useEffect(
    () => () => {
      if (pipWindow && !pipWindow.closed) pipWindow.close();
    },
    [pipWindow],
  );

  return { pipWindow, open, close };
}
