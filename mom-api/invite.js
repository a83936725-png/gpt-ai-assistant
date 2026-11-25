/* 雙向邀請禮 (mounted by index.js): a friend who joins with an invite code gets a welcome gift, and the mom who invited
 * her gets an invite gift. The gifts are 好孕點數 kept on each phone; the server only decides, once, who qualifies:
 *
 *   POST /invite/claim {code?}   logged in → {gift, counted, user}
 *
 * She qualifies when her account is new (made in the last 14 days), she has agreed to the current privacy policy and
 * her app has finished setup (the app only asks then). Her inviter is counted at that moment, no longer at sign-up:
 * an account that never agreed (a LINE sign-up that said no is deleted) or never set the app up doesn't count. The
 * caps are the same as before: 30 a day per code, and 3 a day per code from one network.
 * Joined without the link? Within those 14 days she can type a friend's code: never her own, never one of an account
 * newer than hers (two friends can't invite each other for two gifts each), and once her inviter is set it never
 * changes. Each account gets the welcome gift once. Only the person who joined counts (one level): nothing is given for
 * friends of friends. */
import { POLICY_VERSION } from './policy.js';

export const CLAIM_DAYS = 14;
const DAY_MS = 86400e3;
const LIMITS = {
  claimUser: [20, 600], // claims per account (each typed code is one)
  claimIp: [30, 600], // typed codes per network, so codes can't be tried in bulk
};

export const normCode = (c) => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16);

// what the app needs to know about her own invite: the code she joined with, whether her welcome gift has been
// given, and whether she can still claim it
export const inviteInfo = (u, t) => ({
  by: u.invitedBy || null,
  gift: !!u.giftAt,
  open: !u.giftAt && t - (u.createdAt || 0) <= CLAIM_DAYS * DAY_MS,
});

export function mountInvite(router, {
  store, now, over, clientIp, wrap, currentUser, userOut, referralLimits, needVerify = () => false, metrics = { count: async () => {} },
}) {
  const fail = (res, status, error) => res.status(status).json({ error });
  const already = async (res, user) => res.json({
    gift: false, already: true, counted: false, user: await userOut(user),
  });

  router.post('/invite/claim', wrap(async (req, res) => {
    const user = await currentUser(req);
    if (!user) { fail(res, 401, 'unauthorized'); return; }
    if (await over('claim', user.id, LIMITS.claimUser)) { fail(res, 429, 'too_many'); return; }
    if (!user.consent || user.consent.version !== POLICY_VERSION) { fail(res, 403, 'need_consent'); return; }
    // with codes available, a gift is for an account that proved its Email / phone (no throwaway sign-ups)
    if (needVerify(user)) { fail(res, 403, 'need_verify'); return; }
    const t = now();
    if (user.giftAt) { await already(res, user); return; }
    if (!inviteInfo(user, t).open) { fail(res, 400, 'too_late'); return; }
    const patch = {};
    let code = user.invitedBy;
    if (!code) {
      const typed = normCode(req.body && req.body.code);
      if (!typed) { fail(res, 400, 'no_code'); return; }
      if (await over('claim-ip', clientIp(req), LIMITS.claimIp)) { fail(res, 429, 'too_many'); return; }
      if (typed === user.code) { fail(res, 400, 'own_code'); return; }
      const inviter = await store.getUserByCode(typed);
      if (!inviter || inviter.id === user.id || (inviter.createdAt || 0) >= (user.createdAt || 0)) { fail(res, 400, 'bad_code'); return; }
      code = inviter.code;
      patch.invitedBy = code;
      patch.refPending = true;
    }
    // once per account, even when two requests arrive together
    if (!(await store.claimOnce(`invite-gift:${user.id}`, 2 * CLAIM_DAYS * 86400, t))) { await already(res, user); return; }
    // accounts made before 0.7.6 were counted at sign-up (no refPending), so they are not counted twice
    let counted = false;
    if (user.refPending || patch.refPending) {
      const ip = clientIp(req);
      if (await store.getUserByCode(code)
        && !(await over('ref-ip', `${code}|${ip}`, referralLimits.ip))
        && !(await over('ref', code, referralLimits.day))) {
        await store.addReferral(code);
        await metrics.count('invite');
        counted = true;
      }
      patch.refPending = false;
    }
    patch.giftAt = t;
    const updated = await store.updateUser(user.id, patch);
    await metrics.count('gift');
    res.json({ gift: true, counted, user: await userOut(updated) });
  }));
}
