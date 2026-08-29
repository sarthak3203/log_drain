import { useState } from 'react';

interface OneTimeKeyDialogProps {
  title: string;
  apiKey: string;
  description: string;
  onClose: () => void;
}

export default function OneTimeKeyDialog({
  title,
  apiKey,
  description,
  onClose,
}: OneTimeKeyDialogProps) {
  const [copied, setCopied] = useState(false);

  async function copyKey() {
    try {
      await navigator.clipboard.writeText(apiKey);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/40 p-6" role="dialog" aria-modal="true">
      <div className="max-w-lg w-full rounded-xl border border-gray-200 bg-white p-6 shadow-xl">
        <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
        <p className="mt-2 text-sm text-gray-600">{description}</p>
        <p className="mt-2 text-sm font-medium text-amber-700">
          Save this key now. It cannot be displayed again.
        </p>
        <div className="mt-4 break-all rounded-lg bg-gray-900 p-4 font-mono text-sm text-green-400">
          {apiKey}
        </div>
        <div className="mt-5 flex justify-end gap-3">
          <button
            onClick={copyKey}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            {copied ? 'Copied' : 'Copy key'}
          </button>
          <button
            onClick={onClose}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            I have saved it
          </button>
        </div>
      </div>
    </div>
  );
}
