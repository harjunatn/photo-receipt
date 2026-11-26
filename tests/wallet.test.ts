import { describe, expect, it } from 'vitest';
import { createDemo } from '../src/dashboard/demo';
import { qrisModeOf, walletNet } from '../src/dashboard/QrisMode';
import { bankLine, netOf, parseAmount } from '../src/dashboard/Wallet';

describe('titip saldo', () => {
  it('reads an amount however it was typed, and works out what is left of a payment', () => {
    expect(parseAmount('150.000')).toBe(150_000);
    expect(parseAmount('Rp 1.250.000,-')).toBe(1_250_000);
    expect(parseAmount('')).toBe(0);
    expect(parseAmount('semua')).toBe(0);
    expect(netOf({ amount: 25_000, fee_doku: 500, fee_platform: 200 })).toBe(24_300);
    expect(bankLine({ bank: 'BCA', account_no: '0000 1111 22', holder: 'Budi Santoso' })).toBe('BCA · 0000 1111 22 · a.n. Budi Santoso');
  });

  it('keeps the books of the example wallet: fees off every QRIS, payouts off the balance', async () => {
    const demo = createDemo();
    const budi = demo.apiFor({ id: 'demo-budi', name: 'Booth Budi' });
    const summary = await budi.walletSummary();
    expect(summary.enabled).toBe(true);
    expect(summary.transactions).toBeGreaterThan(0);
    expect(summary.fees_doku).toBe(summary.transactions * 500);
    expect(summary.fees_platform).toBe(summary.transactions * 200);
    expect(summary.available).toBe(summary.gross - summary.fees_doku - summary.fees_platform - summary.paid_out - summary.pending);
    expect(summary.available).toBeGreaterThan(0);

    const entries = await budi.walletEntries(0, 500);
    expect(entries.total).toBe(summary.transactions);
    expect(entries.rows.reduce((sum, row) => sum + netOf(row), 0)).toBe(summary.gross - summary.fees_doku - summary.fees_platform);
    expect((await budi.status()).wallet).toBe(true);

    // A franchise with its own QRIS has no wallet, and no Dompet menu.
    const senja = demo.apiFor({ id: 'demo-pusat', name: 'Foto Senja' });
    expect((await senja.walletSummary()).available).toBe(0);
    expect((await senja.status()).wallet).toBe(false);

    // What the platform owner sees adds up to the same numbers.
    const board = await demo.admin.payoutBoard();
    expect(board.requests[0]).toMatchObject({ status: 'requested', franchise: 'Booth Budi', amount: summary.pending });
    expect(board.wallets).toEqual([{ id: 'demo-budi', name: 'Booth Budi', enabled: true, blocked: false, available: summary.available, pending: summary.pending, paid_out: summary.paid_out }]);
    expect(board.platform_fees).toBe(summary.fees_platform);
    expect(board.held).toBe(summary.available + summary.pending);
    const listed = (await demo.admin.listFranchises()).franchises.find((row) => row.id === 'demo-budi');
    expect(listed).toMatchObject({ wallet_enabled: true, wallet_available: summary.available });
  });

  it('takes one payout request at a time, no sooner than the platform allows, and gives a rejected one back', async () => {
    const demo = createDemo();
    const budi = demo.apiFor({ id: 'demo-budi', name: 'Booth Budi' });
    const before = await budi.walletSummary();

    // One is still waiting for the transfer.
    await expect(budi.walletRequest(10_000)).rejects.toThrow(/belum ditransfer/);

    // Turned down: the money is available again, and that request does not count as this week's turn.
    const open = (await demo.admin.payoutBoard()).requests.find((row) => row.status === 'requested')!;
    await demo.admin.settlePayout(open.id, false, 'Rekening salah');
    const afterReject = await budi.walletSummary();
    expect(afterReject.pending).toBe(0);
    expect(afterReject.available).toBe(before.available + before.pending);
    expect((await budi.walletPayouts()).find((row) => row.id === open.id)).toMatchObject({ status: 'rejected', note: 'Rekening salah' });

    await expect(budi.walletRequest(0)).rejects.toThrow(/Jumlahnya/);
    await expect(budi.walletRequest(afterReject.available + 1)).rejects.toThrow(/Jumlahnya/);
    await budi.walletRequest(100_000);
    const asked = await budi.walletSummary();
    expect(asked.pending).toBe(100_000);
    expect(asked.available).toBe(afterReject.available - 100_000);

    // Transferred: it moves from waiting to paid out, the balance stays as it was.
    const second = (await demo.admin.payoutBoard()).requests.find((row) => row.status === 'requested')!;
    await demo.admin.settlePayout(second.id, true, 'ref 123');
    const paid = await budi.walletSummary();
    expect(paid.pending).toBe(0);
    expect(paid.paid_out).toBe(before.paid_out + 100_000);
    expect(paid.available).toBe(asked.available);

    // The next one has to wait for the platform's days between payouts, unless that is set to none.
    await expect(budi.walletRequest(50_000)).rejects.toThrow(/Belum waktunya/);
    await demo.admin.savePlatform({ ...(await demo.admin.getPlatform()), wallet: { dokuFee: 500, platformFee: 200, payoutDays: 0 } });
    await budi.walletRequest(50_000);
    expect((await budi.walletSummary()).pending).toBe(50_000);
  });

  it('has finance staff in the example: listed, added once per email, re-keyed and removed by the platform owner', async () => {
    const demo = createDemo();
    expect(demo.account).toMatchObject({ superadmin: true, finance: false });
    expect(demo.financeAccount).toMatchObject({ superadmin: false, finance: true, franchise: null });
    expect((await demo.admin.listFinance()).map((user) => user.email)).toEqual(['keuangan@contoh.id']);

    await demo.admin.addFinance('rina@contoh.id', 'sementara-123');
    await expect(demo.admin.addFinance('rina@contoh.id', 'sementara-123')).rejects.toThrow(/sudah dipakai/);
    const rina = (await demo.admin.listFinance()).find((user) => user.email === 'rina@contoh.id')!;
    expect(rina).toMatchObject({ must_change_password: true, last_sign_in_at: null });

    await demo.admin.removeFinance(rina.user_id);
    expect((await demo.admin.listFinance()).map((user) => user.email)).toEqual(['keuangan@contoh.id']);
    // Who settled a payout is kept with it.
    expect((await demo.admin.payoutBoard()).requests.find((row) => row.status === 'paid')?.settled_by).toBe('keuangan@contoh.id');
  });

  it('names the three ways of taking QRIS, and shows what a titip saldo payment leaves', () => {
    expect(qrisModeOf(false, false)).toBe('manual');
    // Without automatic QRIS the account does not matter.
    expect(qrisModeOf(false, true)).toBe('manual');
    expect(qrisModeOf(true, false)).toBe('own');
    expect(qrisModeOf(true, true)).toBe('wallet');

    const fees = { doku_fee: 500, platform_fee: 200 };
    expect(walletNet(15_000, fees)).toBe(14_300);
    // Like the server: the platform's fee never takes more than what is left after DOKU's.
    expect(walletNet(600, fees)).toBe(0);
    expect(walletNet(500, fees)).toBe(0);
  });

  it('is the franchise\'s own choice, which the platform owner can stop', async () => {
    const demo = createDemo();
    const citra = demo.apiFor({ id: 'demo-citra', name: 'Citra Photo' });
    const row = async () => (await demo.admin.listFranchises()).franchises.find((franchise) => franchise.id === 'demo-citra')!;
    expect(await citra.walletSummary()).toMatchObject({ enabled: false, blocked: false, agreed_at: null });
    expect((await citra.status()).wallet).toBe(false);
    expect((await citra.dokuGet()).platform_ready).toBe(true);

    // Choosing it records when the fees were agreed to, and the Dompet menu shows from then on.
    await citra.walletChoose(true);
    expect((await citra.walletSummary()).enabled).toBe(true);
    expect((await citra.walletSummary()).agreed_at).toBeTruthy();
    expect((await citra.status()).wallet).toBe(true);
    expect(await row()).toMatchObject({ wallet_enabled: true, wallet_blocked: false });
    // The setup page still shows the franchise's own DOKU keys, never the platform's.
    expect((await citra.dokuGet()).source).toBe('none');

    // Leaving it keeps the balance and the menu.
    const balance = (await citra.walletSummary()).available;
    expect(balance).toBeGreaterThan(0);
    await citra.walletChoose(false);
    expect(await citra.walletSummary()).toMatchObject({ enabled: false, available: balance });
    expect((await citra.status()).wallet).toBe(true);

    // Stopped by the platform owner: off at once, and not to be chosen until allowed again.
    await citra.walletChoose(true);
    await demo.admin.allowFranchiseWallet('demo-citra', false);
    expect(await citra.walletSummary()).toMatchObject({ enabled: false, blocked: true, available: balance });
    expect(await row()).toMatchObject({ wallet_enabled: false, wallet_blocked: true });
    await expect(citra.walletChoose(true)).rejects.toThrow(/dihentikan/);
    expect((await demo.admin.payoutBoard()).wallets.find((wallet) => wallet.id === 'demo-citra')).toMatchObject({ enabled: false, blocked: true });

    // Allowing it again leaves the choice with the franchise.
    await demo.admin.allowFranchiseWallet('demo-citra', true);
    expect(await citra.walletSummary()).toMatchObject({ enabled: false, blocked: false });
    await citra.walletChoose(true);
    expect((await citra.walletSummary()).enabled).toBe(true);
  });

  it('needs an account to send the money to', async () => {
    const demo = createDemo();
    const citra = demo.apiFor({ id: 'demo-citra', name: 'Citra Photo' });
    expect((await citra.walletSummary()).enabled).toBe(false);

    await citra.walletChoose(true);
    const summary = await citra.walletSummary();
    expect(summary.enabled).toBe(true);
    expect(summary.bank).toBeNull();
    await expect(citra.walletRequest(10_000)).rejects.toThrow(/rekening/i);

    await citra.walletSaveBank({ bank: 'Mandiri', account_no: '1230004567890', holder: 'Citra' });
    await citra.walletRequest(10_000);
    const board = await demo.admin.payoutBoard();
    expect(board.requests.filter((row) => row.status === 'requested').map((row) => row.franchise)).toEqual(expect.arrayContaining(['Citra Photo', 'Booth Budi']));
    expect(board.requests.find((row) => row.franchise === 'Citra Photo')?.bank).toEqual({ bank: 'Mandiri', account_no: '1230004567890', holder: 'Citra' });
  });
});
