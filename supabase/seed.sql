-- Atlas Service Portal — seed data
-- Roster, mentors, partners and events for Fall 2026.
-- Safe to re-run: every insert is idempotent on its primary key.

insert into settings (id, hour_requirement, swab_cap, semester) values (1, 3, 1, 'Fall 2026')
  on conflict (id) do update set hour_requirement = excluded.hour_requirement,
    swab_cap = excluded.swab_cap, semester = excluded.semester;

insert into mentors (name, group_name) values
  ('Meghana Kottapalli', null),
  ('Michael Lee', null),
  ('Easton Rowell', null),
  ('Laney Brown', null),
  ('Madeleine Hawkins', null),
  ('David Kleinrock', null),
  ('Ava Hilsabeck', null),
  ('Charlie Cannold', null),
  ('Riley Dunn', null),
  ('Amelia Wynn', null),
  ('Wyatt McAvoy', null),
  ('Emma Chaffee', null)
  on conflict (name) do nothing;

insert into orgs (id, name, location, description, impact_metric, givepulse_code, givepulse_link, active) values
  ('campus-kitchen', 'Campus Kitchen', '1065 Gaines School Rd, Athens, GA 30605', 'Cook meals to fight hunger in Athens.', 'Meals Cooked', 'Atlas-EndHunger', 'https://uga.givepulse.com/shift/694811', true),
  ('thomas-lay', 'Thomas Lay', '297 Hoyt St, Athens, GA 30601', 'Teach students a business-themed lesson plus a club activity led by Atlas.', 'Kids Taught', null, null, true),
  ('ugarden', 'UGArden', '2510 S Milledge Ave, Athens, GA 30605', 'Volunteer at the UGA garden to promote sustainable growing. Dress in long pants and layers.', 'Plants Impacted', null, null, true),
  ('esp', 'ESP Miracle League', '189 FVW Dr, Watkinsville, GA 30677', 'Have fun with and assist ESP members at the Miracle League baseball game.', 'ESP Members Assisted', 'TBD', null, true),
  ('ados', 'ADOS Book Donation', 'Stelling Study', 'Donate books to support SWAB (Shop With a Bulldog). Books must be kid-friendly if possible (ages 5-12). At most one hour from this event counts toward the membership requirement.', 'Books Donated', null, null, true),
  ('sga-closet', 'SGA Clothing Closet', '2nd Floor, Tate Student Center', 'Sort professional clothing donations for students.', 'Items Sorted', null, null, false)
  on conflict (id) do update set name = excluded.name,
    location = excluded.location, description = excluded.description,
    impact_metric = excluded.impact_metric, givepulse_code = excluded.givepulse_code,
    givepulse_link = excluded.givepulse_link, active = excluded.active;

-- Long-form arrival/prep notes shown on the member Signup page. Kept out
-- of the multi-row insert above (like `website`) since it's long enough
-- that it reads better as its own statement, dollar-quoted so the
-- embedded line breaks don't need escaping.
update orgs set directions = $UGARDEN$UGArden is located on 2510 South Milledge Avenue, the very next right turn after you pass the State Botanical Gardens:

- Look for the cream-colored barn; this is where someone from our team will meet you!
- There is a UGA bus route that makes a stop at UGArden called, "Riverbend Connector," and it is by request only. (Simply call UGA Transportation, request the Riverbend Connector for UGArden, and you should be good to go.)
- There is parking available around the corner from the barn.

Please be prepared for the weather:
- Dressing in long pants and layers is recommended, even in the warmer months.
- Close toed shoes are required, a water bottle recommended.
- Things like hats and gloves are optional, and we have work gloves here ready for you to use.$UGARDEN$
where id = 'ugarden';

-- capacity 0 means open to the whole cohort (the ADOS book drive)
insert into events (id, org_id, event_date, start_time, end_time, capacity) values
  ('ck-0928', 'campus-kitchen', '2026-09-28', '17:30', '19:30', 5),
  ('tl-0928', 'thomas-lay', '2026-09-28', '14:45', '17:00', 5),
  ('ug-1009', 'ugarden', '2026-10-09', '15:00', '17:00', 5),
  ('tl-1012', 'thomas-lay', '2026-10-12', '14:45', '17:00', 5),
  ('ck-1013', 'campus-kitchen', '2026-10-13', '18:00', '20:00', 5),
  ('ados-1014', 'ados', '2026-10-14', '18:30', '20:00', 0),
  ('esp-1103', 'esp', '2026-11-03', '18:00', '20:30', 10),
  ('esp-1105', 'esp', '2026-11-05', '18:00', '20:30', 10),
  ('ck-1110', 'campus-kitchen', '2026-11-10', '17:30', '19:30', 5)
  on conflict (id) do update set org_id = excluded.org_id,
    event_date = excluded.event_date, start_time = excluded.start_time,
    end_time = excluded.end_time, capacity = excluded.capacity;

-- The roster. A member can only sign in if their email is here.
-- mentor_id stays null until an officer assigns it on the Groups page.
insert into roster (email, full_name) values
  ('tko39240@uga.edu', 'Taylor Oldham'),
  ('cooperlechtman@uga.edu', 'Cooper Lechtman'),
  ('mh51662@uga.edu', 'Maikayla Huynh'),
  ('mgg67572@uga.edu', 'Micah Getlin'),
  ('eeb09107@uga.edu', 'Ella Bell'),
  ('lfb74413@uga.edu', 'Leighton Bittel'),
  ('eth51001@uga.edu', 'Eden Haight'),
  ('lrc84901@uga.edu', 'Lauren Crotty'),
  ('ss53970@uga.edu', 'Sai Shankar Sadhu'),
  ('mes35304@uga.edu', 'Madison Stevens'),
  ('roryobrien@uga.edu', 'Rory O''Brien'),
  ('ag76768@uga.edu', 'Adaa Gupta'),
  ('hlf43023@uga.edu', 'Hunter Fennel'),
  ('oll34120@uga.edu', 'Olivia Levine'),
  ('wnc84972@uga.edu', 'Walker Cooney'),
  ('lcf26948@uga.edu', 'Lauren Friduss'),
  ('aiz77872@uga.edu', 'Aaron Zacharia'),
  ('gkv13898@uga.edu', 'Gavin Vu'),
  ('asp56695@uga.edu', 'Austin Pouryousefi'),
  ('gfk47494@uga.edu', 'Gracie Krawiec'),
  ('eo36256@uga.edu', 'Eren Ozkaynak'),
  ('ehb34539@uga.edu', 'Ella Bender'),
  ('rth26970@uga.edu', 'Robert Tucker Howard'),
  ('jlr85731@uga.edu', 'James Roberts'),
  ('rwm34462@uga.edu', 'Ryan Miller'),
  ('adh81215@uga.edu', 'Alex Holtgrewe'),
  ('wkc93486@uga.edu', 'William Crain'),
  ('rmh82941@uga.edu', 'Mason Hinkle'),
  ('acc72677@uga.edu', 'Amelia Chen'),
  ('whm25835@uga.edu', 'Hayne Miller'),
  ('jyk81227@uga.edu', 'Joshua Kim'),
  ('egj35917@uga.edu', 'Emily Jansen'),
  ('aw71871@uga.edu', 'Anthony Wang'),
  ('zb68933@uga.edu', 'Zachary Barber'),
  ('mlm00394@uga.edu', 'Megan Muschick'),
  ('elj98961@uga.edu', 'Ella Jacquin'),
  ('plf23904@uga.edu', 'Parker French'),
  ('cuc06215@uga.edu', 'Connor Cross'),
  ('rah74930@uga.edu', 'Ryder Hilding'),
  ('slp66386@uga.edu', 'Shira Preis'),
  ('bhh95406@uga.edu', 'Brooke Hawken'),
  ('tck96556@uga.edu', 'Tanish Karnala'),
  ('av98510@uga.edu', 'Alan Villavicencio'),
  ('mas12010@uga.edu', 'Mimi Sonawane'),
  ('snn06581@uga.edu', 'Sanath Nallagatla'),
  ('jew77888@uga.edu', 'Emory Williams'),
  ('vld76371@uga.edu', 'Lane Dougherty'),
  ('wh26202@uga.edu', 'Will Harden'),
  ('mhw82716@uga.edu', 'Mac Wickland'),
  ('njp50638@uga.edu', 'Nicholas Pope'),
  ('ash88371@uga.edu', 'Ari Harkavy'),
  ('mwk54892@uga.edu', 'Maciej (Magic) Kulczycki'),
  ('caw49998@uga.edu', 'Clara Williams'),
  ('aps75305@uga.edu', 'Arnav Singh'),
  ('het95805@uga.edu', 'Hayden Trebon'),
  ('gtr38333@uga.edu', 'Graham Reed'),
  ('ncg50634@uga.edu', 'Neeva Gokhale'),
  ('is92347@uga.edu', 'Ishi Sondhi'),
  ('evw22073@uga.edu', 'Eden Wassersug'),
  ('mnf27374@uga.edu', 'Mona Ferraioli'),
  ('jjb99819@uga.edu', 'Julia Bailey'),
  ('hbs36256@uga.edu', 'Henry Strahm'),
  ('eph28464@uga.edu', 'Evan Harrison'),
  ('lml90178@uga.edu', 'Luke Lohman'),
  ('jhs57278@uga.edu', 'Jordan Sirota')
  on conflict (email) do update set full_name = excluded.full_name;
