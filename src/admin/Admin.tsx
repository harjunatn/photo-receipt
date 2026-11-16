import { useEffect, useState } from 'preact/hooks';
import { printer, usePrinter } from '../lib/printer/manager';
import { Overlay, ReceiptPaper } from '../ui/components';
import { FramesTab } from './FramesTab';
import { HistoryTab } from './HistoryTab';
import { LookTab } from './LookTab';
import { PackagesTab } from './PackagesTab';
import { PaymentTab } from './PaymentTab';
import { PrinterTab } from './PrinterTab';
import { SummaryTab } from './SummaryTab';
import { SystemTab } from './SystemTab';

const TABS = [
  { id: 'summary', label: 'Ringkasan', view: SummaryTab },
  { id: 'printer', label: 'Printer', view: PrinterTab },
  { id: 'frames', label: 'Frame', view: FramesTab },
  { id: 'look', label: 'Struk & Tampilan', view: LookTab },
  { id: 'packages', label: 'Harga', view: PackagesTab },
  { id: 'payment', label: 'Bayar & Voucher', view: PaymentTab },
  { id: 'history', label: 'Riwayat', view: HistoryTab },
  { id: 'system', label: 'Sistem', view: SystemTab },
] as const;

/** The staff-only settings area, reached from the welcome screen with the PIN. */
export function Admin({ onExit }: { onExit: () => void }) {
  const [tabId, setTabId] = useState<(typeof TABS)[number]['id']>('summary');
  const state = usePrinter();
  const View = TABS.find((tab) => tab.id === tabId)!.view;

  // A guest's last simulated print is not something the operator asked to see.
  useEffect(() => printer.dismissSimulated(), []);

  return (
    <div class="admin">
      <div class="admin-bar">
        <h1>Pengaturan booth</h1>
        <span class="spacer" style={{ flex: 1 }} />
        <button class="btn small dark" onClick={onExit}>
          Keluar → layar tamu
        </button>
      </div>
      <div class="tabs">
        {TABS.map((tab) => (
          <button key={tab.id} class={`tab ${tab.id === tabId ? 'on' : ''}`} onClick={() => setTabId(tab.id)}>
            {tab.label}
          </button>
        ))}
      </div>
      {/* Keyed by tab so each tab opens scrolled to its top. */}
      <div class="admin-body" key={tabId}>
        <View />
      </div>

      {state.simulated && (
        <Overlay onClose={() => printer.dismissSimulated()}>
          <div class="card dialog wide">
            <span class="tag warn">Simulasi cetak — tidak ada kertas yang keluar</span>
            <div class="preview-box" style={{ width: '100%', maxHeight: '60vh' }}>
              <ReceiptPaper bits={state.simulated} />
            </div>
            <button class="btn" onClick={() => printer.dismissSimulated()}>
              Tutup
            </button>
          </div>
        </Overlay>
      )}
    </div>
  );
}
