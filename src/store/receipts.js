import fs from "node:fs";
import path from "node:path";
import { readJson, writeJson } from "../json-file.js";

// The receipts service's record of an account's real-money purchases (GET /fortnite/api/receipts/v1/account/:id/receipts,
// services/fortnite/receipts.js), kept with the account in <dataDir>/accounts/<id>/receipts.json, so deleting the account
// deletes it. Each is {appStore, appStoreId, receiptId, receiptInfo}: the purchase page's transaction id is the receipt
// id and its validation info, as in the purchase flow's own receipt.
export function createReceiptStore(dataDir) {
  const fileOf = (accountId) => path.join(dataDir, "accounts", accountId, "receipts.json");
  const read = (accountId) => {
    const file = fileOf(accountId);
    return fs.existsSync(file) ? readJson(file) : [];
  };
  return {
    list: (accountId) => read(accountId),
    find: (accountId, receiptId) => read(accountId).find((receipt) => receipt.receiptId === receiptId) ?? null,
    add(accountId, receipt) {
      writeJson(fileOf(accountId), [...read(accountId), receipt]);
    }
  };
}
