import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const gameRooms = sqliteTable("game_rooms", {
  code: text("code").primaryKey(),
  state: text("state").notNull(),
  version: integer("version").notNull().default(0),
  updatedAt: integer("updated_at").notNull(),
});
