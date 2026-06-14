/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("_pb_users_auth_")

  // remove field
  collection.fields.removeById("bool2654125802")

  // remove field
  collection.fields.removeById("date1801940630")

  // remove field
  collection.fields.removeById("select514551986")

  // remove field
  collection.fields.removeById("select2196247231")

  // remove field
  collection.fields.removeById("text4138069096")

  // remove field
  collection.fields.removeById("text886301676")

  // remove field
  collection.fields.removeById("text2116995567")

  // remove field
  collection.fields.removeById("text2423874872")

  // remove field
  collection.fields.removeById("text647187223")

  // remove field
  collection.fields.removeById("text3044014327")

  // remove field
  collection.fields.removeById("text2582076222")

  // remove field
  collection.fields.removeById("bool975385478")

  // remove field
  collection.fields.removeById("json2322279298")

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("_pb_users_auth_")

  // add field
  collection.fields.addAt(7, new Field({
    "hidden": false,
    "id": "bool2654125802",
    "name": "online",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "bool"
  }))

  // add field
  collection.fields.addAt(8, new Field({
    "hidden": false,
    "id": "date1801940630",
    "max": "",
    "min": "",
    "name": "lastSeen",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "date"
  }))

  // add field
  collection.fields.addAt(9, new Field({
    "hidden": false,
    "id": "select514551986",
    "maxSelect": 1,
    "name": "mi_plan",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "select",
    "values": [
      "Gratuito",
      "Mensual",
      "Anual",
      "Pago por uso"
    ]
  }))

  // add field
  collection.fields.addAt(10, new Field({
    "hidden": false,
    "id": "select2196247231",
    "maxSelect": 1,
    "name": "metodo_de_pago",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "select",
    "values": [
      "Tarjeta de Crédito",
      "PayPal",
      "Transferencia Bancaria",
      "Bizum"
    ]
  }))

  // add field
  collection.fields.addAt(13, new Field({
    "autogeneratePattern": "",
    "hidden": false,
    "id": "text4138069096",
    "max": 0,
    "min": 0,
    "name": "githubAccessToken",
    "pattern": "",
    "presentable": false,
    "primaryKey": false,
    "required": false,
    "system": false,
    "type": "text"
  }))

  // add field
  collection.fields.addAt(14, new Field({
    "autogeneratePattern": "",
    "hidden": false,
    "id": "text886301676",
    "max": 0,
    "min": 0,
    "name": "lastSelectedModelId",
    "pattern": "",
    "presentable": false,
    "primaryKey": false,
    "required": false,
    "system": false,
    "type": "text"
  }))

  // add field
  collection.fields.addAt(18, new Field({
    "autogeneratePattern": "",
    "hidden": false,
    "id": "text2116995567",
    "max": 0,
    "min": 0,
    "name": "last_project_id_local",
    "pattern": "",
    "presentable": false,
    "primaryKey": false,
    "required": false,
    "system": false,
    "type": "text"
  }))

  // add field
  collection.fields.addAt(19, new Field({
    "autogeneratePattern": "",
    "hidden": false,
    "id": "text2423874872",
    "max": 0,
    "min": 0,
    "name": "last_project_id_production",
    "pattern": "",
    "presentable": false,
    "primaryKey": false,
    "required": false,
    "system": false,
    "type": "text"
  }))

  // add field
  collection.fields.addAt(20, new Field({
    "autogeneratePattern": "",
    "hidden": false,
    "id": "text647187223",
    "max": 0,
    "min": 0,
    "name": "last_project_root",
    "pattern": "",
    "presentable": false,
    "primaryKey": false,
    "required": false,
    "system": false,
    "type": "text"
  }))

  // add field
  collection.fields.addAt(21, new Field({
    "autogeneratePattern": "",
    "hidden": false,
    "id": "text3044014327",
    "max": 0,
    "min": 0,
    "name": "Block_Messages",
    "pattern": "",
    "presentable": false,
    "primaryKey": false,
    "required": false,
    "system": false,
    "type": "text"
  }))

  // add field
  collection.fields.addAt(22, new Field({
    "autogeneratePattern": "",
    "hidden": false,
    "id": "text2582076222",
    "max": 0,
    "min": 0,
    "name": "registration_ip",
    "pattern": "",
    "presentable": false,
    "primaryKey": false,
    "required": false,
    "system": false,
    "type": "text"
  }))

  // add field
  collection.fields.addAt(23, new Field({
    "hidden": false,
    "id": "bool975385478",
    "name": "has_received_free_credit",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "bool"
  }))

  // add field
  collection.fields.addAt(24, new Field({
    "hidden": false,
    "id": "json2322279298",
    "maxSize": 999999999999,
    "name": "data_contex",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "json"
  }))

  return app.save(collection)
})
