/*
  Warnings:

  - A unique constraint covering the columns `[user_id,input_key]` on the table `jobs` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "jobs_user_id_input_key_key" ON "jobs"("user_id", "input_key");
