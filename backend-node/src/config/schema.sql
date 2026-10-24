-- Dheeksha Insurance Database Schema Definition
-- Target Database: MariaDB 10.5+ / MySQL 8.0+
-- Storage Engine: InnoDB
-- Character Encoding: utf8mb4
-- Collation: utf8mb4_unicode_ci

-- Table 1: admins
-- Stores administrative accounts and bcrypt password hashes
CREATE TABLE IF NOT EXISTS `admins` (
  `id` VARCHAR(36) NOT NULL,
  `email` VARCHAR(255) NOT NULL,
  `hashed_password` VARCHAR(255) NOT NULL,
  `created_at` DATETIME NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `ix_admins_email` (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Table 2: enquiries
-- Stores customer insurance enquiries, contact details, and lifecycle statuses
CREATE TABLE IF NOT EXISTS `enquiries` (
  `id` VARCHAR(36) NOT NULL,
  `full_name` VARCHAR(100) NOT NULL,
  `mobile_number` VARCHAR(20) NOT NULL,
  `whatsapp_number` VARCHAR(20) DEFAULT NULL,
  `vehicle_type` VARCHAR(30) NOT NULL,
  `vehicle_registration_number` VARCHAR(50) DEFAULT NULL,
  `requirement` VARCHAR(30) NOT NULL,
  `message` TEXT DEFAULT NULL,
  `status` VARCHAR(20) NOT NULL,
  `created_at` DATETIME NOT NULL,
  `updated_at` DATETIME NOT NULL,
  PRIMARY KEY (`id`),
  KEY `ix_enquiries_created_at` (`created_at`),
  KEY `ix_enquiries_mobile_number` (`mobile_number`),
  KEY `ix_enquiries_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Table 3: enquiry_notes
-- Stores administrative notes linked to an enquiry with ON DELETE CASCADE
CREATE TABLE IF NOT EXISTS `enquiry_notes` (
  `id` VARCHAR(36) NOT NULL,
  `enquiry_id` VARCHAR(36) NOT NULL,
  `text` TEXT NOT NULL,
  `created_at` DATETIME NOT NULL,
  PRIMARY KEY (`id`),
  KEY `ix_enquiry_notes_enquiry_id` (`enquiry_id`),
  CONSTRAINT `fk_enquiry_notes_enquiry_id` FOREIGN KEY (`enquiry_id`) REFERENCES `enquiries` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
