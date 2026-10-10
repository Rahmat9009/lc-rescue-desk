import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
export const cases = sqliteTable("cases", {
 id: text("id").primaryKey(), owner: text("owner").notNull(),
 revision: integer("revision").notNull(), snapshot: text("snapshot").notNull(), updatedAt: text("updated_at").notNull(),
});
