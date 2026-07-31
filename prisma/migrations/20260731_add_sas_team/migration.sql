-- Add SaS (Sales & Service) to the TechTeam enum. Must be committed before the value is used.
ALTER TYPE "TechTeam" ADD VALUE IF NOT EXISTS 'SaS';
