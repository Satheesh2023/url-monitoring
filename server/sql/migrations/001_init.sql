-- Baseline schema (same as former Prisma init). Safe to re-run: IF NOT EXISTS.
CREATE TABLE IF NOT EXISTS `targets` (
    `id` VARCHAR(191) NOT NULL,
    `url` VARCHAR(2048) NOT NULL,
    `name` VARCHAR(255) NULL,
    `poll_interval_sec` INTEGER NOT NULL DEFAULT 5,
    `timeout_ms` INTEGER NOT NULL DEFAULT 10000,
    `max_redirects` INTEGER NOT NULL DEFAULT 5,
    `status_min` INTEGER NOT NULL DEFAULT 200,
    `status_max` INTEGER NOT NULL DEFAULT 399,
    `keyword` VARCHAR(500) NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `checks` (
    `id` VARCHAR(191) NOT NULL,
    `target_id` VARCHAR(191) NOT NULL,
    `checked_at` DATETIME(3) NOT NULL,
    `ok` BOOLEAN NOT NULL,
    `http_status` INTEGER NULL,
    `response_time_ms` INTEGER NULL,
    `error_message` TEXT NULL,
    `body_snippet` VARCHAR(500) NULL,
    INDEX `checks_target_id_checked_at_idx`(`target_id`, `checked_at` DESC),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
