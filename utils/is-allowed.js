/**
 * Decides whether the bot may answer a message.
 * Group chats are checked against the group list, one-to-one chats against the user list.
 * An empty list allows everyone.
 * @param {Object} param
 * @param {boolean} param.isGroup
 * @param {string} param.userId
 * @param {string} [param.groupId]
 * @param {Array<string>} param.allowedUserIds
 * @param {Array<string>} param.allowedGroupIds
 * @returns {boolean}
 */
const isAllowed = ({
  isGroup,
  userId,
  groupId,
  allowedUserIds = [],
  allowedGroupIds = [],
}) => {
  if (isGroup) return allowedGroupIds.length === 0 || allowedGroupIds.includes(groupId);
  return allowedUserIds.length === 0 || allowedUserIds.includes(userId);
};

export default isAllowed;
