-- Per-plot fertilizer (allocated from a reallocatable pool = the player's plot
-- count). Modifies the plot's multiply odds; 0 = penalty, 1 = baseline, 2+ boost.
ALTER TABLE "OrchardPlot" ADD COLUMN "fertilizer" INTEGER NOT NULL DEFAULT 0;
