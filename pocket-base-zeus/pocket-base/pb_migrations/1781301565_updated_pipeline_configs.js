/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pipeline_cfgs_001")

  // add field
  collection.fields.addAt(11, new Field({
    "hidden": false,
    "id": "bool540587787",
    "name": "ingestionActive",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "bool"
  }))

  // add field
  collection.fields.addAt(12, new Field({
    "hidden": false,
    "id": "bool4051862290",
    "name": "retrievalActive",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "bool"
  }))

  // add field
  collection.fields.addAt(13, new Field({
    "hidden": false,
    "id": "bool2953561670",
    "name": "orchestrationActive",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "bool"
  }))

  // add field
  collection.fields.addAt(14, new Field({
    "hidden": false,
    "id": "bool1952182173",
    "name": "generationActive",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "bool"
  }))

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pipeline_cfgs_001")

  // remove field
  collection.fields.removeById("bool540587787")

  // remove field
  collection.fields.removeById("bool4051862290")

  // remove field
  collection.fields.removeById("bool2953561670")

  // remove field
  collection.fields.removeById("bool1952182173")

  return app.save(collection)
})
