import { Overlay, toast } from '../ui/components';

/** A password to hand over, shown once so the platform owner can pass it on. */
export interface Handover {
  email: string;
  password: string;
}

/**
 * The temporary password of a new account, with the links that go with it and
 * one button that copies the lot, ready to paste into a message.
 */
export function HandoverDialog(props: {
  handover: Handover;
  /** Who it is for, e.g. "admin franchise". */
  who: string;
  links: { label: string; url: string }[];
  /** What "Salin semua" puts on the clipboard. */
  text: string;
  /** What the toast says was copied. */
  copied: string;
  onClose: () => void;
}) {
  const { handover } = props;
  return (
    <Overlay>
      <div class="card dialog">
        <h2 class="heading small">Password sementara</h2>
        <p class="lead">
          Berikan ke {props.who}, beserta tautannya. Saat pertama masuk, ia diminta membuat password sendiri.
        </p>
        <dl class="facts">
          <div>
            <dt>Email</dt>
            <dd>{handover.email}</dd>
          </div>
          <div>
            <dt>Password</dt>
            <dd class="mono">{handover.password}</dd>
          </div>
          {props.links.map((link) => (
            <div style={{ gridColumn: '1 / -1' }} key={link.label}>
              <dt>{link.label}</dt>
              <dd class="share-qr-url">{link.url}</dd>
            </div>
          ))}
        </dl>
        <p class="hint">Password ini tidak bisa ditampilkan lagi setelah jendela ini ditutup. Kalau hilang, buat password baru.</p>
        <div class="row center">
          <button
            class="btn small"
            onClick={() =>
              void navigator.clipboard
                .writeText(props.text)
                .then(() => toast(props.copied))
                .catch(() => toast('Browser tidak mengizinkan menyalin.'))
            }
          >
            Salin semua
          </button>
          <button class="btn small primary" onClick={props.onClose}>
            Sudah kucatat
          </button>
        </div>
      </div>
    </Overlay>
  );
}
