/**
 * Handshake AI - Curated Product Imagery Registry
 * Every SKU in the database is paired with an accurate, high-resolution product photograph.
 * All URLs are served in modern compressed format (WebP/JPEG) from reliable CDNs.
 * You can also swap any of these for your custom Cloudinary links.
 */

export const SKU_IMAGE_MAP: Record<string, string> = {
  // Knitwear & Apparel
  "KNT-CASH-007": "https://images.unsplash.com/photo-1576871337632-b9aef4c17ab9?w=800&auto=format&fit=crop&q=80", // Cashmere sweater
  "TSH-PREM-001": "https://images.unsplash.com/photo-1521572267360-ee0c2909d518?w=800&auto=format&fit=crop&q=80", // Premium white tee
  "TSH-STD-001": "https://images.unsplash.com/photo-1583743814966-8936f5b7be1a?w=800&auto=format&fit=crop&q=80", // Black crew tee
  "TSH-STD-024": "https://images.unsplash.com/photo-1503342217505-b0a15ec3261c?w=800&auto=format&fit=crop&q=80", // Everyday tee
  "HOD-BASIC-026": "https://images.unsplash.com/photo-1556905055-8f358a7a47b2?w=800&auto=format&fit=crop&q=80", // Zip hoodie
  "HOD-OVER-002": "https://images.unsplash.com/photo-1620799140408-edc6dcb6d633?w=800&auto=format&fit=crop&q=80", // Oversized hoodie
  "DEN-RAW-003": "https://images.unsplash.com/photo-1541099649105-f69ad21f3246?w=800&auto=format&fit=crop&q=80", // Selvedge denim jeans
  "TRK-BOT-012": "https://images.unsplash.com/photo-1552902865-b72c031ac5ea?w=800&auto=format&fit=crop&q=80", // Track pants
  "SWT-VNTG-013": "https://images.unsplash.com/photo-1614975058789-41316d0e2e9c?w=800&auto=format&fit=crop&q=80", // Vintage sweatshirt
  "DRS-SUM-001": "https://images.unsplash.com/photo-1572804013309-59a88b7e92f1?w=800&auto=format&fit=crop&q=80", // Summer dress
  "SLK-PURE-006": "https://images.unsplash.com/photo-1610030469983-98e550d6193c?w=800&auto=format&fit=crop&q=80", // Pure silk saree / fabric

  // Outerwear & Winter
  "JAC-LEATH-001": "https://images.unsplash.com/photo-1551028719-00167b16eac5?w=800&auto=format&fit=crop&q=80", // Leather biker jacket
  "JCK-LTHR-004": "https://images.unsplash.com/photo-1521223890158-f9f7c3d5d504?w=800&auto=format&fit=crop&q=80", // Faux leather jacket
  "WNT-PARK-011": "https://images.unsplash.com/photo-1544923246-77307dd654cb?w=800&auto=format&fit=crop&q=80", // Puffer winter parka
  "GLV-LTHR-036": "https://images.unsplash.com/photo-1584917865442-de89df76afd3?w=800&auto=format&fit=crop&q=80", // Leather gloves

  // Electronics, Computing & Audio
  "MBL-FLAG-001": "https://images.unsplash.com/photo-1592899677977-9c10ca588bbd?w=800&auto=format&fit=crop&q=80", // Flagship smartphone
  "AUD-HDPH-001": "https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=800&auto=format&fit=crop&q=80", // Wireless studio headphones
  "AUD-EAR-001": "https://images.unsplash.com/photo-1546435770-a3e426bf472b?w=800&auto=format&fit=crop&q=80", // Wired earphones
  "EAR-WIR-035": "https://images.unsplash.com/photo-1590658268037-6bf12165a8df?w=800&auto=format&fit=crop&q=80", // Wireless earbuds
  "SND-BLU-028": "https://images.unsplash.com/photo-1608043152269-423dbba4e7e1?w=800&auto=format&fit=crop&q=80", // Bluetooth speaker
  "TEC-KBD-001": "https://images.unsplash.com/photo-1587829741301-dc798b83add3?w=800&auto=format&fit=crop&q=80", // Mechanical keyboard
  "TEC-MSE-001": "https://images.unsplash.com/photo-1615663245857-ac93bb7c39e7?w=800&auto=format&fit=crop&q=80", // Wireless mouse
  "TEC-MSE-STD": "https://images.unsplash.com/photo-1527864550417-7fd91fc51a46?w=800&auto=format&fit=crop&q=80", // USB optical mouse
  "TEC-PAD-001": "https://images.unsplash.com/photo-1616440347437-b1c73416efc2?w=800&auto=format&fit=crop&q=80", // Extended desk mat
  "DESK-MAT-023": "https://images.unsplash.com/photo-1527443224154-c4a3942d3acf?w=800&auto=format&fit=crop&q=80", // Vegan leather desk mat
  "CPU-CHIP-001": "https://images.unsplash.com/photo-1591799264318-7e6ef8ddb7ea?w=800&auto=format&fit=crop&q=80", // Desktop CPU chip
  "GPM-RAM-001": "https://images.unsplash.com/photo-1562976540-1502c2145186?w=800&auto=format&fit=crop&q=80", // DDR5 RAM modules
  "LNS-CAM-010": "https://images.unsplash.com/photo-1617005082133-548c4dd27f35?w=800&auto=format&fit=crop&q=80", // 50mm camera lens
  "SLR-PANEL-001": "https://images.unsplash.com/photo-1509391365360-2e959784a276?w=800&auto=format&fit=crop&q=80", // Solar panel
  "AUT-CHG-001": "https://images.unsplash.com/photo-1583863788434-e58a36330cf0?w=800&auto=format&fit=crop&q=80", // Car charger
  "AUT-HLD-001": "https://images.unsplash.com/photo-1584438784894-089d6a62b8fa?w=800&auto=format&fit=crop&q=80", // Car phone mount

  // Watches & Fine Jewelry
  "WCH-CHR-008": "https://images.unsplash.com/photo-1524805444758-089113d48a6d?w=800&auto=format&fit=crop&q=80", // Minimalist chronograph watch
  "GLD-COIN-001": "https://images.unsplash.com/photo-1610375461246-83df859d849d?w=800&auto=format&fit=crop&q=80", // Gold bullion coin
  "SLV-RING-009": "https://images.unsplash.com/photo-1605100804763-247f67b3557e?w=800&auto=format&fit=crop&q=80", // Silver band ring

  // Footwear & Headwear
  "SHO-RUN-014": "https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=800&auto=format&fit=crop&q=80", // Running shoes
  "FTW-SNK-001": "https://images.unsplash.com/photo-1525966222134-fcfa99b8ae77?w=800&auto=format&fit=crop&q=80", // High top sneakers
  "SNC-CANV-030": "https://images.unsplash.com/photo-1463100099107-aa0980c362e6?w=800&auto=format&fit=crop&q=80", // Canvas sneakers
  "CAP-CORD-015": "https://images.unsplash.com/photo-1588850561407-ed78c282e89b?w=800&auto=format&fit=crop&q=80", // Corduroy cap

  // Luggage, Bags & Accessories
  "LGG-TRV-001": "https://images.unsplash.com/photo-1565026057447-bc90a3dceb87?w=800&auto=format&fit=crop&q=80", // Cabin suitcase
  "BCK-TRAV-033": "https://images.unsplash.com/photo-1553062407-98eeb64c6a62?w=800&auto=format&fit=crop&q=80", // Laptop travel backpack
  "ACC-BAG-001": "https://images.unsplash.com/photo-1547949003-9792a18a2601?w=800&auto=format&fit=crop&q=80", // Duffle travel bag
  "BAG-CANV-005": "https://images.unsplash.com/photo-1544816155-12df9643f363?w=800&auto=format&fit=crop&q=80", // Canvas tote
  "BAG-LITE-025": "https://images.unsplash.com/photo-1597633425046-08f5110420b5?w=800&auto=format&fit=crop&q=80", // Packable shopping bag
  "WAL-LTHR-029": "https://images.unsplash.com/photo-1627123424574-724758594e93?w=800&auto=format&fit=crop&q=80", // Slim leather wallet
  "LGG-PAS-001": "https://images.unsplash.com/photo-1584824486509-112e4181ff6b?w=800&auto=format&fit=crop&q=80", // Passport wallet
  "SUN-POL-032": "https://images.unsplash.com/photo-1511499767150-a48a237f0083?w=800&auto=format&fit=crop&q=80", // Wayfarer sunglasses
  "UMB-WND-038": "https://images.unsplash.com/photo-1556909114-f6e7ad7d3136?w=800&auto=format&fit=crop&q=80", // Automatic umbrella
  "FRG-LUX-001": "https://images.unsplash.com/photo-1592945403244-b3fbafd7f539?w=800&auto=format&fit=crop&q=80", // Eau de Parfum

  // Furniture & Homeware
  "OFF-CHR-001": "https://images.unsplash.com/photo-1589578228447-e1a4e481c6c8?w=800&auto=format&fit=crop&q=80", // Ergonomic office chair
  "OFF-LAM-001": "https://images.unsplash.com/photo-1507473885765-e6ed057f782c?w=800&auto=format&fit=crop&q=80", // LED desk lamp
  "SWR-CRYST-001": "https://images.unsplash.com/photo-1578749556568-bc2c40e68b61?w=800&auto=format&fit=crop&q=80", // Crystal flower vase
  "HOM-BLN-001": "https://images.unsplash.com/photo-1584100936595-c0654b55a2e2?w=800&auto=format&fit=crop&q=80", // King size blanket
  "HOM-PLW-001": "https://images.unsplash.com/photo-1584100936798-29bebe174828?w=800&auto=format&fit=crop&q=80", // Memory foam pillows
  "KIT-BLN-001": "https://images.unsplash.com/photo-1570222094114-d054a817e56b?w=800&auto=format&fit=crop&q=80", // Countertop blender
  "KIT-KNF-001": "https://images.unsplash.com/photo-1593618998160-e34014e67546?w=800&auto=format&fit=crop&q=80", // Steel chef knife
  "KIT-MUG-001": "https://images.unsplash.com/photo-1514432324607-a09d9b4aefdd?w=800&auto=format&fit=crop&q=80", // Ceramic mug
  "MUG-CER-020": "https://images.unsplash.com/photo-1577937927133-66ef06acdf18?w=800&auto=format&fit=crop&q=80", // Stoneware pour-over mug
  "HME-FAN-001": "https://images.unsplash.com/photo-1579783902614-a3fb3927b675?w=800&auto=format&fit=crop&q=80", // Tower room fan
  "ORB-HUM-034": "https://images.unsplash.com/photo-1585771724684-38269d6639fd?w=800&auto=format&fit=crop&q=80", // Mist humidifier
  "CND-SOY-037": "https://images.unsplash.com/photo-1603006905003-be475563bc59?w=800&auto=format&fit=crop&q=80", // Scented soy candle
  "CHM-CLN-001": "https://images.unsplash.com/photo-1585421514738-01798e348b17?w=800&auto=format&fit=crop&q=80", // Sanitizer cleaner

  // Food, Tea & Coffee
  "KIT-COF-001": "https://images.unsplash.com/photo-1559056199-641a0ac8b55e?w=800&auto=format&fit=crop&q=80", // Whole coffee beans
  "COF-BEANS-019": "https://images.unsplash.com/photo-1587734195503-904fca47e0e9?w=800&auto=format&fit=crop&q=80", // Arabica coffee beans
  "TEA-MATC-017": "https://images.unsplash.com/photo-1576092768241-dec231879fc3?w=800&auto=format&fit=crop&q=80", // Matcha tin
  "GFT-PRM-016": "https://images.unsplash.com/photo-1549007994-cb92caebd54b?w=800&auto=format&fit=crop&q=80", // Dark chocolate box
  "FOD-PRM-001": "https://images.unsplash.com/photo-1452195100486-9cc805987862?w=800&auto=format&fit=crop&q=80", // Artisanal cheese wheel

  // Sports, Fitness & Lifestyle
  "SPT-DBL-001": "https://images.unsplash.com/photo-1586401100295-7a8096fd231a?w=800&auto=format&fit=crop&q=80", // Cast iron dumbbells
  "SPT-MAT-001": "https://images.unsplash.com/photo-1601925260368-ae2f83cf8b7f?w=800&auto=format&fit=crop&q=80", // Yoga mat
  "BOT-HYDR-027": "https://images.unsplash.com/photo-1602143407151-7111542de6e8?w=800&auto=format&fit=crop&q=80", // Vacuum water bottle
  "GYM-SHK-021": "https://images.unsplash.com/photo-1594498653385-d5172c532c00?w=800&auto=format&fit=crop&q=80", // Shaker bottle
  "GYM-TOW-022": "https://images.unsplash.com/photo-1583847268964-b28dc8f51f92?w=800&auto=format&fit=crop&q=80", // Gym towel
  "MED-VIT-001": "https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=800&auto=format&fit=crop&q=80", // Multivitamin tablets
  "SKN-SERM-018": "https://images.unsplash.com/photo-1620916566398-39f1143ab7be?w=800&auto=format&fit=crop&q=80", // Vitamin C serum
  "NOT-LETH-031": "https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?w=800&auto=format&fit=crop&q=80", // Hardcover notebook
  "TOY-RC-001": "https://images.unsplash.com/photo-1594787318286-3d835c1d207f?w=800&auto=format&fit=crop&q=80", // RC monster truck
};

export const CATEGORY_FALLBACK_IMAGES: Record<string, string> = {
  apparel: "https://images.unsplash.com/photo-1523381210434-271e8be1f52b?w=800&auto=format&fit=crop&q=80",
  knitwear: "https://images.unsplash.com/photo-1576871337632-b9aef4c17ab9?w=800&auto=format&fit=crop&q=80",
  outerwear: "https://images.unsplash.com/photo-1551028719-00167b16eac5?w=800&auto=format&fit=crop&q=80",
  electronics: "https://images.unsplash.com/photo-1526738549149-8e07eca6c147?w=800&auto=format&fit=crop&q=80",
  furniture: "https://images.unsplash.com/photo-1589578228447-e1a4e481c6c8?w=800&auto=format&fit=crop&q=80",
  homeware: "https://images.unsplash.com/photo-1513694203232-719a280e022f?w=800&auto=format&fit=crop&q=80",
  home: "https://images.unsplash.com/photo-1513694203232-719a280e022f?w=800&auto=format&fit=crop&q=80",
  accessories: "https://images.unsplash.com/photo-1523293182086-7651a899d37f?w=800&auto=format&fit=crop&q=80",
  food: "https://images.unsplash.com/photo-1559056199-641a0ac8b55e?w=800&auto=format&fit=crop&q=80",
  sports: "https://images.unsplash.com/photo-1586401100295-7a8096fd231a?w=800&auto=format&fit=crop&q=80",
  fitness: "https://images.unsplash.com/photo-1586401100295-7a8096fd231a?w=800&auto=format&fit=crop&q=80",
  jewelry: "https://images.unsplash.com/photo-1605100804763-247f67b3557e?w=800&auto=format&fit=crop&q=80",
  watches: "https://images.unsplash.com/photo-1524805444758-089113d48a6d?w=800&auto=format&fit=crop&q=80",
  footwear: "https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=800&auto=format&fit=crop&q=80",
};

export const LOCAL_CATALOG_IMAGES: Record<string, string> = {
  "ACC-BAG-001": "/catalog_images/ACC-BAG-001_vintage_canvas_duffle_travel_bag.jpg",
  "AUD-EAR-001": "/catalog_images/AUD-EAR-001_standard_3_5mm_wired_earphones.jpg",
  "AUT-CHG-001": "/catalog_images/AUT-CHG-001_dual_port_fast_car_charger_65w.jpg",
  "AUT-HLD-001": "/catalog_images/AUT-HLD-001_magnetic_air_vent_phone_mount.jpg",
  "BAG-CANV-005": "/catalog_images/BAG-CANV-005_heavyweight_utility_canvas_tote.jpg",
  "BAG-LITE-025": "/catalog_images/BAG-LITE-025_packable_nylon_shopping_tote.jpg",
  "BOT-HYDR-027": "/catalog_images/BOT-HYDR-027_double_wall_vacuum_water_bottle_1l.jpg",
  "CAP-CORD-015": "/catalog_images/CAP-CORD-015_corduroy_unstructured_strapback_cap.jpg",
  "CHM-CLN-001": "/catalog_images/CHM-CLN-001_eco_multi_surface_sanitizer_5l.jpg",
  "CND-SOY-037": "/catalog_images/CND-SOY-037_scented_soy_wax_candle_jar.jpg",
  "COF-BEANS-019": "/catalog_images/COF-BEANS-019_single_origin_arabica_coffee_beans.jpg",
  "CPU-CHIP-001": "/catalog_images/CPU-CHIP-001_octa_core_desktop_processor.jpg",
  "DEN-RAW-003": "/catalog_images/DEN-RAW-003_raw_selvedge_denim_jeans.jpg",
  "DESK-MAT-023": "/catalog_images/DESK-MAT-023_vegan_leather_minimalist_desk_mat.jpg",
  "DRS-SUM-001": "/catalog_images/DRS-SUM-001_summer_floral_print_sundress.jpg",
  "EAR-WIR-035": "/catalog_images/EAR-WIR-035_true_wireless_anc_earbuds.jpg",
  "FOD-PRM-001": "/catalog_images/FOD-PRM-001_organic_artisanal_cheese_wheel_1kg.jpg",
  "FRG-LUX-001": "/catalog_images/FRG-LUX-001_luxury_eau_de_parfum_100ml.jpg",
  "FTW-SNK-001": "/catalog_images/FTW-SNK-001_retro_high_top_canvas_sneakers.jpg",
  "GFT-PRM-016": "/catalog_images/GFT-PRM-016_artisanal_gourmet_dark_chocolate_box.jpg",
  "GLD-COIN-001": "/catalog_images/GLD-COIN-001_24k_gold_minted_bullion_coin_5g.jpg",
  "GLV-LTHR-036": "/catalog_images/GLV-LTHR-036_touchscreen_compatible_leather_gloves.jpg",
  "GPM-RAM-001": "/catalog_images/GPM-RAM-001_ddr5_32gb_desktop_ram_kit.jpg",
  "GYM-SHK-021": "/catalog_images/GYM-SHK-021_pro_stainless_steel_shaker_bottle.jpg",
  "GYM-TOW-022": "/catalog_images/GYM-TOW-022_quick_dry_microfiber_gym_towel.jpg",
  "HME-FAN-001": "/catalog_images/HME-FAN-001_tower_oscillating_room_fan.jpg",
  "HOD-BASIC-026": "/catalog_images/HOD-BASIC-026_essential_fleece_zip_up_hoodie.jpg",
  "HOD-OVER-002": "/catalog_images/HOD-OVER-002_oversized_fleece_pullover_hoodie.jpg",
  "HOM-BLN-001": "/catalog_images/HOM-BLN-001_microfiber_king_size_blanket.jpg",
  "HOM-PLW-001": "/catalog_images/HOM-PLW-001_memory_foam_bed_pillow_pair.jpg",
  "JAC-LEATH-001": "/catalog_images/JAC-LEATH-001_genuine_leather_biker_jacket.jpg",
  "JCK-LTHR-004": "/catalog_images/JCK-LTHR-004_faux_leather_biker_jacket.jpg",
  "KIT-BLN-001": "/catalog_images/KIT-BLN-001_nutri_extract_countertop_blender_900w.jpg",
  "KIT-COF-001": "/catalog_images/KIT-COF-001_artisanal_whole_coffee_beans_500g.jpg",
  "KIT-KNF-001": "/catalog_images/KIT-KNF-001_german_steel_chef_knife_8_inch.jpg",
  "KIT-MUG-001": "/catalog_images/KIT-MUG-001_ceramic_coffee_mug_350ml.jpg",
  "KNT-CASH-007": "/catalog_images/KNT-CASH-007_100_cashmere_crewneck_sweater.jpg",
  "LGG-PAS-001": "/catalog_images/LGG-PAS-001_rfid_blocking_leather_passport_wallet.jpg",
  "LGG-TRV-001": "/catalog_images/LGG-TRV-001_hard_shell_cabin_suitcase_20in.jpg",
  "LNS-CAM-010": "/catalog_images/LNS-CAM-010_50mm_f_1_8_prime_smartphone_lens.jpg",
  "MBL-FLAG-001": "/catalog_images/MBL-FLAG-001_flagship_smartphone_256gb.jpg",
  "MED-VIT-001": "/catalog_images/MED-VIT-001_multivitamin_complex_90_tablets.jpg",
  "MUG-CER-020": "/catalog_images/MUG-CER-020_matte_stoneware_pour_over_mug.jpg",
  "NOT-LETH-031": "/catalog_images/NOT-LETH-031_hardcover_dotted_journal_notebook.jpg",
  "OFF-CHR-001": "/catalog_images/OFF-CHR-001_ergonomic_mesh_swivel_office_chair.jpg",
  "OFF-LAM-001": "/catalog_images/OFF-LAM-001_led_dimmable_eye_care_desk_lamp.jpg",
  "ORB-HUM-034": "/catalog_images/ORB-HUM-034_ultrasonic_cool_mist_desk_humidifier.jpg",
  "SKN-SERM-018": "/catalog_images/SKN-SERM-018_vitamin_c_radiance_serum_batch_b.jpg",
  "SLK-PURE-006": "/catalog_images/SLK-PURE-006_pure_mulberry_silk_saree.jpg",
  "SLV-RING-009": "/catalog_images/SLV-RING-009_925_sterling_silver_band_ring.jpg",
  "SNC-CANV-030": "/catalog_images/SNC-CANV-030_low_top_classic_canvas_sneakers.jpg",
  "SPT-DBL-001": "/catalog_images/SPT-DBL-001_adjustable_cast_iron_dumbbell_set_20kg.jpg",
  "SPT-MAT-001": "/catalog_images/SPT-MAT-001_non_slip_alignment_yoga_mat_6mm.jpg",
  "SUN-POL-032": "/catalog_images/SUN-POL-032_polarized_retro_wayfarer_sunglasses.jpg",
  "SWR-CRYST-001": "/catalog_images/SWR-CRYST-001_handcrafted_crystal_flower_vase.jpg",
  "SWT-VNTG-013": "/catalog_images/SWT-VNTG-013_vintage_wash_acid_sweatshirt.jpg",
  "TEC-KBD-001": "/catalog_images/TEC-KBD-001_rgb_mechanical_gaming_keyboard.jpg",
  "TEC-MSE-001": "/catalog_images/TEC-MSE-001_ergonomic_wireless_optical_mouse.jpg",
  "TEC-MSE-STD": "/catalog_images/TEC-MSE-STD_standard_wired_usb_optical_mouse.jpg",
  "TOY-RC-001": "/catalog_images/TOY-RC-001_stunt_rc_4wd_monster_truck.jpg",
  "TRK-BOT-012": "/catalog_images/TRK-BOT-012_tapered_fleece_track_pants.jpg",
  "TSH-PREM-001": "/catalog_images/TSH-PREM-001_premium_heavyweight_cotton_tee.jpg",
  "TSH-STD-024": "/catalog_images/TSH-STD-024_standard_everyday_cotton_tee.jpg",
  "UMB-WND-038": "/catalog_images/UMB-WND-038_windproof_automatic_travel_umbrella.jpg",
  "WCH-CHR-008": "/catalog_images/WCH-CHR-008_minimalist_chronograph_sapphire_watch.jpg",
  "WNT-PARK-011": "/catalog_images/WNT-PARK-011_insulated_puffer_winter_parka.jpg",
};

// In-memory resolution cache for ultra-fast instantaneous lookups on re-renders
const resolvedImageCache = new Map<string, string>();

/**
 * Optimizes Cloudinary URLs using dynamic delivery transformations:
 * - f_auto: Format auto (WebP / AVIF depending on browser)
 * - q_auto: Intelligent visual quality compression (reduces payload by 40-60%)
 * - w_{width}: Server-side downscaling to prevent transferring huge multi-megapixel originals
 */
export function optimizeCloudinaryUrl(url: string, width = 500): string {
  if (!url || typeof url !== "string") return url;
  if (!url.includes("res.cloudinary.com")) return url;

  // Avoid injecting duplicate transformations if already present
  if (url.includes("/upload/f_auto") || url.includes("/upload/q_auto") || url.includes(`/upload/w_${width}`)) {
    return url;
  }

  return url.replace("/upload/", `/upload/f_auto,q_auto,w_${width}/`);
}

export function getProductImage(
  sku_code: string,
  category?: string,
  name?: string,
  image_url?: string | null,
  width = 500
): string {
  const cacheKey = `${sku_code}_${image_url || ""}_w${width}`;
  if (resolvedImageCache.has(cacheKey)) {
    return resolvedImageCache.get(cacheKey)!;
  }

  let finalUrl = "";

  // 1. Direct Cloudinary secure URL from database if available (with f_auto, q_auto, w_{width})
  if (image_url && image_url.trim().length > 0) {
    finalUrl = optimizeCloudinaryUrl(image_url.trim(), width);
  } else if (LOCAL_CATALOG_IMAGES[sku_code]) {
    // 2. Local static asset image from public/catalog_images
    finalUrl = LOCAL_CATALOG_IMAGES[sku_code];
  } else if (SKU_IMAGE_MAP[sku_code]) {
    finalUrl = SKU_IMAGE_MAP[sku_code];
  } else {
    // Name keyword matching
    const n = (name || "").toLowerCase();
    if (n.includes("tee") || n.includes("shirt")) finalUrl = "https://images.unsplash.com/photo-1521572267360-ee0c2909d518?w=800&auto=format&fit=crop&q=80";
    else if (n.includes("jacket")) finalUrl = "https://images.unsplash.com/photo-1551028719-00167b16eac5?w=800&auto=format&fit=crop&q=80";
    else if (n.includes("hoodie") || n.includes("sweatshirt")) finalUrl = "https://images.unsplash.com/photo-1556905055-8f358a7a47b2?w=800&auto=format&fit=crop&q=80";
    else if (n.includes("headphone")) finalUrl = "https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=800&auto=format&fit=crop&q=80";
    else if (n.includes("earphone") || n.includes("earbud")) finalUrl = "https://images.unsplash.com/photo-1590658268037-6bf12165a8df?w=800&auto=format&fit=crop&q=80";
    else if (n.includes("phone") || n.includes("smartphone")) finalUrl = "https://images.unsplash.com/photo-1592899677977-9c10ca588bbd?w=800&auto=format&fit=crop&q=80";
    else if (n.includes("watch")) finalUrl = "https://images.unsplash.com/photo-1524805444758-089113d48a6d?w=800&auto=format&fit=crop&q=80";
    else if (n.includes("chair")) finalUrl = "https://images.unsplash.com/photo-1589578228447-e1a4e481c6c8?w=800&auto=format&fit=crop&q=80";
    else if (n.includes("knife")) finalUrl = "https://images.unsplash.com/photo-1593618998160-e34014e67546?w=800&auto=format&fit=crop&q=80";
    else if (n.includes("vase")) finalUrl = "https://images.unsplash.com/photo-1578749556568-bc2c40e68b61?w=800&auto=format&fit=crop&q=80";
    else if (n.includes("coffee")) finalUrl = "https://images.unsplash.com/photo-1559056199-641a0ac8b55e?w=800&auto=format&fit=crop&q=80";
    else if (n.includes("gold") || n.includes("coin")) finalUrl = "https://images.unsplash.com/photo-1610375461246-83df859d849d?w=800&auto=format&fit=crop&q=80";
    else if (n.includes("solar")) finalUrl = "https://images.unsplash.com/photo-1509391365360-2e959784a276?w=800&auto=format&fit=crop&q=80";
    else {
      const cat = (category || "").toLowerCase();
      if (CATEGORY_FALLBACK_IMAGES[cat]) {
        finalUrl = CATEGORY_FALLBACK_IMAGES[cat];
      } else {
        finalUrl = "https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=800&auto=format&fit=crop&q=80";
      }
    }
  }

  resolvedImageCache.set(cacheKey, finalUrl);
  return finalUrl;
}
