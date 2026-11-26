import { Check } from '../admin/fields';
import { formatRupiah } from '../lib/settings';
import type { OwnerApi, WalletSummary } from './api';
import { dateTime, useLoad } from './ui';

/** The three ways a franchise takes QRIS: its own QR picture, its own DOKU account, or the platform's account (titip saldo). */
export type QrisMode = 'manual' | 'own' | 'wallet';

/** `wallet` says which account automatic QRIS runs on; without automatic QRIS it does not matter. */
export const qrisModeOf = (qrisAuto: boolean, wallet: boolean): QrisMode => (!qrisAuto ? 'manual' : wallet ? 'wallet' : 'own');

/** What one titip saldo payment leaves the franchise, by the rule the server books it with. */
export function walletNet(price: number, fees: { doku_fee: number; platform_fee: number }): number {
  // The platform's fee never takes more than what is left after DOKU's.
  return price - fees.doku_fee - Math.min(fees.platform_fee, Math.max(price - fees.doku_fee, 0));
}

/** The franchise's own pick among the three, each with where the money goes and what it costs. */
export function QrisModePicker(props: { value: QrisMode; wallet: WalletSummary | null; onChange: (mode: QrisMode) => void }) {
  const { wallet } = props;
  const options: { value: QrisMode; label: string; hint: string; disabled?: boolean }[] = [
    {
      value: 'manual',
      label: 'Manual (gambar QRIS)',
      hint: 'Gambar QRIS tokomu ditampilkan, lalu petugas mengecek bukti bayar tamu. Uang masuk langsung ke rekeningmu, tanpa potongan.',
    },
    {
      value: 'own',
      label: 'Otomatis, akun DOKU sendiri',
      hint: 'Tablet membuat kode QR untuk tiap sesi, dan sesi mulai sendiri begitu dibayar. Uang masuk langsung ke akun DOKU-mu; perlu mendaftar di DOKU dan mengisi kuncinya di sini.',
    },
    {
      value: 'wallet',
      label: 'Otomatis, titip saldo',
      hint: !wallet
        ? 'Sama otomatisnya, tanpa mendaftar DOKU: uang masuk ke akun platform, dipotong biaya per transaksi, lalu dicairkan ke rekeningmu.'
        : wallet.blocked
          ? 'Tidak tersedia: titip saldo dihentikan oleh platform untuk franchise ini. Hubungi pemilik platform.'
          : `Sama otomatisnya, tanpa mendaftar DOKU: uang masuk ke akun platform, dipotong ${formatRupiah(wallet.doku_fee + wallet.platform_fee)} per transaksi, lalu dicairkan ke rekeningmu lewat menu Dompet.`,
      disabled: !wallet || wallet.blocked,
    },
  ];
  return (
    <div class="field" role="radiogroup" aria-label="Cara kerja QRIS">
      <span>Cara kerja QRIS</span>
      {options.map((option) => (
        <label class={`check ${option.disabled ? 'off' : ''}`} key={option.value}>
          <input
            type="radio"
            name="qris-mode"
            checked={props.value === option.value}
            disabled={option.disabled}
            onChange={() => props.onChange(option.value)}
          />
          <span>
            {option.label}
            <small>{option.hint}</small>
          </span>
        </label>
      ))}
    </div>
  );
}

/**
 * What titip saldo means for this franchise, with the fees as they are now. While it is not on yet,
 * the franchise has to agree before the choice can be saved.
 */
export function WalletTerms(props: {
  api: OwnerApi;
  wallet: WalletSummary;
  /** A price of this franchise, to show the fees on. 0 when it has none. */
  examplePrice: number;
  agreed: boolean;
  onAgree: (agreed: boolean) => void;
}) {
  const { wallet, examplePrice } = props;
  // Only the setup function knows whether the platform's own DOKU account is filled in.
  const doku = useLoad(() => props.api.dokuGet(), [props.api]);
  return (
    <>
      {wallet.enabled && (
        <p class="hint">
          Titip saldo <b>aktif</b>
          {wallet.agreed_at ? `, disetujui ${dateTime(wallet.agreed_at)}` : ''}. Saldo dan pencairannya ada di menu <b>Dompet</b>.
        </p>
      )}
      <ul class="terms">
        <li>Uang QRIS tamu masuk ke akun DOKU platform, bukan langsung ke rekeningmu.</li>
        <li>
          Tiap transaksi dipotong <b>{formatRupiah(wallet.doku_fee)}</b> biaya DOKU dan <b>{formatRupiah(wallet.platform_fee)}</b> biaya platform.
          {examplePrice > 0 && ` Contoh: sesi ${formatRupiah(examplePrice)} menjadi ${formatRupiah(walletNet(examplePrice, wallet))} untukmu.`}
        </li>
        <li>
          Bersihnya tercatat di menu <b>Dompet</b>. Kamu mengajukan pencairan dari sana
          {wallet.payout_days > 0 ? `, paling sering sekali tiap ${wallet.payout_days} hari` : ''}, lalu platform mentransfernya ke rekeningmu.
        </li>
        <li>Kamu bisa pindah ke cara lain kapan saja. Saldo yang sudah terkumpul tetap bisa dicairkan.</li>
      </ul>
      {doku.data && !doku.data.platform_ready && (
        <p class="banner err">Akun DOKU platform belum siap, jadi QRIS lewat titip saldo belum bisa menerima pembayaran. Hubungi pemilik platform.</p>
      )}
      {!wallet.enabled && (
        <Check
          label="Saya setuju dengan biaya dan cara pencairan ini"
          hint="Persetujuan dicatat bersama waktunya, dan berlaku begitu kamu menekan Simpan."
          checked={props.agreed}
          onChange={props.onAgree}
        />
      )}
    </>
  );
}
