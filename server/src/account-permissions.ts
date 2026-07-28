export function canResetAccountPassword(
  requesterIsAdmin: boolean,
  targetIsAdmin: boolean,
  requesterManagesTarget: boolean
) {
  return requesterIsAdmin || (!targetIsAdmin && requesterManagesTarget);
}
