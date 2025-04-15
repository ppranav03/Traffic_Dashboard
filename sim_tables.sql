
DROP DATABASE IF EXISTS traffic_visual;

CREATE DATABASE traffic_visual;

USE traffic_visual;

-- Create the users table
CREATE TABLE IF NOT EXISTS users (
	user_id INT AUTO_INCREMENT PRIMARY KEY,
	username VARCHAR(50) NOT NULL UNIQUE,
	password VARCHAR(255) NOT NULL
);

CREATE TABLE IF NOT EXISTS simulations (
	sim_id INT AUTO_INCREMENT PRIMARY KEY,
	sim_name varchar(32),
	sim_date varchar(32),
    sim_owner INT,
    FOREIGN KEY (sim_owner) REFERENCES users(user_id),
    UNIQUE (sim_name, sim_owner)
);

CREATE TABLE IF NOT EXISTS text_files (
	file_index INT AUTO_INCREMENT UNIQUE,
	file_type INT,
	file_content LONGBLOB, -- only takes up 2 more bytes
    file_owner INT,
    file_sim INT,
    FOREIGN KEY (file_sim) REFERENCES simulations(sim_id),
	FOREIGN KEY (file_owner) REFERENCES users(user_id),
    UNIQUE (file_sim, file_type)
);

CREATE TABLE IF NOT EXISTS file16 (
	id INT PRIMARY KEY AUTO_INCREMENT,
    report_type INT,
    simulation_time_sec FLOAT,
    vehicle_id INT,
    vehicle_class INT,
    current_link INT,
    current_lane INT,
    next_link INT,
    next_lane INT,
    vehicle_origin_zone INT,
    vehicle_destination_zone INT,
    scheduled_departure_time_sec FLOAT,
    actual_departure_time_sec FLOAT,
    elapsed_time_sec FLOAT,
    total_delay_sec FLOAT,
    stopped_delay_sec FLOAT,
    cumulative_stops INT,
    distance_covered_km FLOAT,
    average_speed_kmh FLOAT,
    exit_speed_kmh FLOAT,
    fuel_used_liters FLOAT,
    hydrocarbon_grams FLOAT,
    carbon_monoxide_grams FLOAT,
    nitrous_oxide_grams FLOAT,
    co2_grams FLOAT,
    particulate_matter_grams FLOAT,
    energy_used_kw FLOAT,
    expected_crashes FLOAT,
    expected_injury_crashes FLOAT,
    expected_fatal_crashes FLOAT,
    low_damage_crashes FLOAT,
    moderate_damage_crashes FLOAT,
    high_damage_crashes FLOAT,
    toll_paid_dollars FLOAT,
    acceleration_noise FLOAT,
    UNIQUE (vehicle_id, simulation_time_sec)
);

INSERT INTO users (user_id, username, password) VALUES ('1', 'root', 'rootpass');

ALTER USER 'root'@'localhost' IDENTIFIED WITH mysql_native_password BY 'P@ssw0rd1234!';

FLUSH PRIVILEGES;
