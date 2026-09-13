import sqlite3

conn = sqlite3.connect('kabadiwala.db')
cur = conn.cursor()

lat_shift = -4.3398
lng_shift = 12.5766

cur.execute('UPDATE collectors SET latitude = latitude + ?, longitude = longitude + ?', (lat_shift, lng_shift))
cur.execute('UPDATE recyclers SET latitude = latitude + ?, longitude = longitude + ?', (lat_shift, lng_shift))
cur.execute('UPDATE lots SET latitude = latitude + ?, longitude = longitude + ?', (lat_shift, lng_shift))

cur.execute('UPDATE collectors SET operating_location = replace(operating_location, "Jaipur", "Kolkata")')
cur.execute('UPDATE recyclers SET location = replace(location, "Jaipur", "Kolkata")')
cur.execute('UPDATE lots SET location = replace(location, "Jaipur", "Kolkata")')
cur.execute('UPDATE transactions SET collection_location = replace(collection_location, "Jaipur", "Kolkata")')
cur.execute('UPDATE transactions SET handover_location = replace(handover_location, "Jaipur", "Kolkata")')

conn.commit()
print("Success")
