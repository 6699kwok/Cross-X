"use strict";
/**
 * src/repositories/UserRepository.js
 * All user-related DB operations — single source of truth for the users_auth table.
 *
 * Depends only on: services/db (Level 1).
 * Controllers and services import from here, never touch SQLite directly.
 */

// Lazy-load db to avoid circular issues at module initialisation
function db() { return require("../services/db"); }

function getAuthUser(userId) {
  return db().getUserAuth(userId);
}

function getAuthUserByPhone(phoneHash) {
  return db().getUserAuthByHash(phoneHash);
}

function saveAuthUser({ userId, phoneHash, displayName, createdAt, lastLogin }) {
  return db().upsertUserAuth({ userId, phoneHash, displayName, createdAt, lastLogin });
}

function getProfileUser(userId) {
  return db().getUser(userId);
}

function patchProfileUser(userId, fields) {
  return db().updateUser(userId, fields);
}

module.exports = {
  getAuthUser,
  getAuthUserByPhone,
  saveAuthUser,
  getProfileUser,
  patchProfileUser,
};
