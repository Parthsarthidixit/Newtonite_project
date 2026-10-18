export const allowedTransitions = {
  'Open': ['In Progress', 'Cancelled'],
  'In Progress': ['Blocked', 'In Review', 'Resolved', 'Cancelled'],
  'Blocked': ['In Progress', 'Cancelled'],
  'In Review': ['In Progress', 'Resolved', 'Cancelled'],
  'Resolved': ['In Progress'],
  'Cancelled': ['Open']
};
export function canTransition(from, to) {
  return from === to || Boolean(allowedTransitions[from]?.includes(to));
}
export function canReadWorkItem(user, item) {
  return user.role === 'admin' || user.teamIds.includes(String(item.teamId));
}
export function canMutateWorkItem(user, item) {
  if (user.role === 'admin' || user.role === 'manager') return canReadWorkItem(user, item);
  return canReadWorkItem(user, item) && (String(item.createdBy) === user.id || String(item.assigneeId || '') === user.id);
}
