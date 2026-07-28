export function canShowPasswordReset(requesterIsAdmin: boolean, memberIsAdmin: boolean) {
  return requesterIsAdmin || !memberIsAdmin;
}
