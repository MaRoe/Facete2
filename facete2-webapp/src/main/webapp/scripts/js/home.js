var jassa = jassa || Jassa;

var rdf = jassa.rdf;
var vocab = jassa.vocab;
var sparql = jassa.sparql;
var service = jassa.service;
var sponate = jassa.sponate;
var facete = jassa.facete;
var geo = jassa.geo;
var util = jassa.util;

var client = jassa.client;

angular.module('Facete2')

.controller('FaceteAppCtrl', ['$scope', '$q', '$rootScope', '$timeout', '$location', '$http', '$dddi', function($scope, $q, $rootScope, $timeout, $location, $http, $dddi) {

    $scope.availableLangs = ['en', 'de', ''];
    $scope.langs = ['en', 'de', ''];

    $scope.uiLangs = ['en'];

    $scope.clearServerSideSparqlCache = function() {
        $http.post('cache/ctrl/clear').then(function() {
            alert('Cache successfully cleared');
        }, function() {
            alert('Failed to clear the cache');
        });
    };

    $scope.$location = $location; // Used by the context menu

    $scope.Math = Math; // Used for progress bar
    $scope.ObjectUtils = jassa.util.ObjectUtils;

    $scope.UpdateUtils = jassa.service.UpdateUtils; // Used by simple-editor.html
    $scope.copy = angular.copy; // Used by simple-editor.html

    $scope.editResource = null;

    $scope.defaultNgModelOptions = {
        //updateOn: 'default blur',
        debounce: {
            'default': 300,
            'blur': 0
        }
    };

    // Code mirror setup
    $scope.editorOptions = {
        ttl: {
            lineWrapping : true,
            lineNumbers: true,
            tabMode: 'indent',
            matchBrackets: true,
            mode: 'text/turtle',
            readOnly: true
        }
    };

    // Used to set pristine on the edit form via forms.edit
    $scope.forms = {};

    // Changing the edit counter invalidates caches and creates a fresh sparql service object
    // so that components will update themselves
    $scope.editCounter = 0;

    //$scope.datasetToEditCounter = new jassa.util.Map();



    $scope.performUpdate = function(rexContext, prefixMapping, form) {
        var updateService = $scope.active.service.updateService;

        var p = jassa.service.UpdateUtils.performUpdate(updateService, rexContext.diff, prefixMapping);
        var x = p.then(function() {
            //var r = $http.post('cache/ctrl/clear');
            var r = Promise.resolve(jQuery.post('cache/ctrl/clear'));

            return r;
        }).then(function() {
            // TODO Reset the sparql cache before calling reset

            form.$setPristine();
            var r = rexContext.reset();
            return r;
        });

        // Note: Only when the update is successful do we reset the form to pristine
        // This will retain edits in case of failure
        $q.when(x).then(function() {
            ++$scope.editCounter;
            //alert('Update successful');
        }, function(e) {
            ++$scope.editCounter;
            //alert('Update failed with reason: ' + e.responseText);
        });
    };

    // TODO Move graphToTurtle to a utility object
    $scope.graphToTurtle = function(graph, prefixMapping) {
        var talis = graph ? jassa.io.TalisRdfJsonUtils.triplesToTalisRdfJson(graph) : null;
        var r = talis ? jassa.io.TalisRdfJsonUtils.talisRdfJsonToTurtle(talis, prefixMapping) : '';
        return r;
    };


    $scope.geoModes = AppConfig.geoModes;
    $scope.edit = AppConfig.edit.createDefaults();

    /* Application UI state */
    $scope.app = AppConfig.ui;


    $scope.$watch('app.data.isOpen', function(state) {
        $scope.resizableConfig = state ?
            AppConfig.resizableConfig.enabled :
            AppConfig.resizableConfig.disabled;
    });

    $scope.active = {
        services: {}
    };

    //$scope.active.config.geoMode = $scope.geoModes[0];


    $scope.datacatSparqlService = service.SparqlServiceBuilder
        .http('static/sparql', [], {type: 'POST'})
        .cache().virtFix().paginate(1000).pageExpand(100).create();


    $scope.selectDataset = function(dataset, resource, distribution) {
        console.log('Dataset selected:', arguments);

        var edit = $scope.edit;

        var dataDist = null;
        var jsDist = null;

        if(!distribution) {
            edit.name = dataset.label;

            typeToResource = _.indexBy(dataset.resources, 'type');

            dataDist = jassa.util.ExceptionUtils.tryEval(function() { return typeToResource['dataset'].items[0]; });
            jsDist = jassa.util.ExceptionUtils.tryEval(function() { return typeToResource['join-summary'].items[0]; });
        } else {

            if(resource.type === 'dataset') {
                dataDist = distribution;
            } else if(resource.type === 'join-summary') {
                jsDist = distribution;
            }
        }

        if(dataDist) {
            edit.dataServiceIri = dataDist.accessUrl;
            edit.dataGraphIris = dataDist.graphs;
        }

        if(jsDist) {
            edit.jsServiceIri = jsDist.accessUrl;
            edit.jsGraphIris = jsDist.graphs;
        }
    };

    var varMapToJson = function(varMap) {
        var result = null;
        if(varMap) {
            result = {};
            varMap.entries().forEach(function(entry) {
                var a = entry.key;
                var b = entry.val;

                result[a.getName()] = b.getName();
            });
            console.log('Rename: ' + result);
        }
        return result;
    };


    // query string arguments
    var qsa = $location.search();
    //alert(JSON.stringify(qsa));

    var convertQsa = function(qsa) {
        var arrayParams = {'defaultGraphUri': true};

        // create a config option by camel casing all qsa attributes
        var result = {};
        _(qsa).each(function(v, k) {
            var key = jQuery.camelCase(k);
            var isArrayParam = arrayParams[key];

            var needsArray = v != null && isArrayParam && !angular.isArray(v);

            var val = needsArray ? (v == null ? [] : [v]) : v;
            result[key] = val;
        });

        return result;
    };

    var specToDataSource = function(spec) {
        var result = {
            dataService: {
                serviceIri: spec.serviceUri,
                defaultGraphIris: spec.defaultGraphUri || []
            }
        };

        return result;
    };

    var tmp = convertQsa(qsa);
    //alert(JSON.stringify(tmp));

    var qsaDataSourceSpec = tmp.serviceUri ? specToDataSource(tmp) : null;



    var tableConfigFacet; // Initialized later - TODO Fix the order

//    var applyScope = function() {
//        if(!$scope.$$phase) {
//            $scope.$apply();
//        }
//    };

    /* Data Sources */

    var dataSourceManager = new DataSourceManager(AppConfig.storeApiUrl);
    var createDefaultWorkspaceConfig = function() {
        var result = {
            name: 'Unnamed Data Source',
            dataService: {
                serviceIri: '',
                defaultGraphIris: []
            },
            joinSummaryService: {
                serviceIri: '',
                defaultGraphIris: []
            },

            sparqlProxyUrl: AppConfig.sparqlProxyUrl,
            conceptPathFinderApiUrl: AppConfig.pathFindingApiUrl,

            facetTreeConfig: facetTreeConfig,
            mapConfig: {
                geoMode:AppConfig.geoModes[0].value,
                quadTreeConfig: {
                    maxItemsPerTileCount: 1000,
                    maxGlobalItemCount: 2000
                }
            },
            tableConfigFacet: tableConfigFacet
        };

        return result;
    };


    var refreshDataSources = function() {
        // TODO: We need to add a query string datasource
        // Check if there is a query string datasource
        var defaults = createDefaultWorkspaceConfig();

        var configs = [];
        $scope.active.serviceConfigs = configs;

        if(qsaDataSourceSpec) {
            var config = qsaDataSourceSpec;
            //alert(JSON.stringify(config));

            _(config).defaults(defaults);
            config.name = 'Query String Datasource';
            configs.push(config);
            applyScope();
        }



        $q.when(dataSourceManager.loadDataSources()).then(function(cs) {
            _(cs).each(function(config) {
                //console.log('Config', config);
                _(config).defaults(defaults);
                configs.push(config);
            });

            return configs;

        }).then(function(configs) {
            $scope.active.serviceConfigs = configs;
            //applyScope();
            //console.log('Configs: ', $scope.active.serviceConfigs);
        }, function() {
            alert('Failed to retrieve data sources');
        });
    };

    $scope.deleteDataSource = function(id) {
        var c = confirm('Delete dataset with id ' + id + '?');
        if(!c) {
            return;
        }

        dataSourceManager.deleteDataSource(id)
            .then(function() {
                refreshDataSources();
            })
            .fail(function() {
                alert('Failed to delete data source with id ' + id);
            });
    };

    $scope.addDataSource = function() {
        var spec = _($scope.edit).clone();

        dataSourceManager.addDataSource(spec)
            .then(function() {
                // Hide data source creation dialog
                $scope.app.dataSources.showAddDialog=false;
                refreshDataSources();
            }).fail(function() {
                alert('Failed to store data');
            });
    };


    /* Geo Link Setup */

    var vs = rdf.NodeFactory.createVar('s');

    //var tableModGeoPath = new facete.TableMod();
    //tableMode.addColumn('s');
    var vPath = rdf.NodeFactory.createUri('http://ns.aksw.org/jassa/ontology/Path');
    var facetTreeConfigGeoLink = new facete.FacetTreeConfig();
    var facetConfigGeoLink = facetTreeConfigGeoLink.getFacetConfig();
    var baseConcept = new sparql.Concept(new sparql.ElementTriplesBlock([new rdf.Triple(vs, vocab.rdf.type, vPath)]), vs);
    facetConfigGeoLink.setBaseConcept(baseConcept);
    tableConfigGeoLink = new facete.TableConfigFacet(facetConfigGeoLink);
    tableConfigGeoLink.togglePath(new facete.Path());
    tableConfigGeoLink.togglePath(facete.Path.parse(vocab.rdfs.label.getUri()));
    tableConfigGeoLink.togglePath(facete.Path.parse('http://ns.aksw.org/jassa/ontology/pathLength'));
    var pathLengthColId = tableConfigGeoLink.getColIdForPath(facete.Path.parse('http://ns.aksw.org/jassa/ontology/pathLength'));

    tableConfigGeoLink.getTableMod().getSortConditions().push(new facete.SortCondition(pathLengthColId, 1));

    /* Dummy init */
    var dummyQuery = new sparql.Query();
    dummyQuery.getProject().add(vs);
    dummyQuery.setQueryPattern(new sparql.ElementTriplesBlock([new rdf.Triple(vs, vs, vs)]));

    var tmpTableMod = new facete.TableMod();
    tmpTableMod.addColumn('s');


    var facetTreeConfig = new facete.FacetTreeConfig();
    var targetFacetTreeConfig = new facete.FacetTreeConfig();


    // On startup, expand the root facet node
    var rootPath = new facete.Path();

    var facetTreeState = facetTreeConfig.getFacetTreeState();

    facetTreeState.getPathExpansions().add(rootPath);
    facetTreeState.getPathHeadToFilter().put(new facete.PathHead(rootPath, false), new facete.ListFilter(null, 10));

//        facetTreeConfig.getExpansionSet().add(rootPath);
//        facetTreeConfig.getExpansionMap().put(rootPath, 1);

    facetTreeState = targetFacetTreeConfig.getFacetTreeState();

    facetTreeState.getPathExpansions().add(rootPath);
    facetTreeState.getPathHeadToFilter().put(new facete.PathHead(rootPath, false), new facete.ListFilter(null, 10));


    var facetConfig = facetTreeConfig.getFacetConfig();
//    var pathTaggerManager = facetConfig.getPathTaggerManager()
//    var taggerMap = pathTaggerManager.getTaggerMap();
    //var pathTaggerManager = facetConfig.getPathTaggerManager()
    var taggerMap = facetTreeConfig.getPathToTags();


    tableConfigFacet = new facete.TableConfigFacet(facetConfig);
    tableConfigFacet.togglePath(new facete.Path());


    var tableMod = tableConfigFacet.getTableMod();
    //tableMod.addColumn('s'); // TODO Instead of 's' use: facetConfig.getBaseConcept().getVar().getName()

    // TODO RESTORE
    taggerMap.table = new facete.ItemTaggerMembership(tableConfigFacet.getPaths());


    var essentialDataElement = sparql.ElementString.create(CannedQueries.essentialDataElementStr);
    var essentialDataElementFactory = new sparql.ElementFactoryConst(essentialDataElement);


    var essentialTableMod = new facete.TableMod();

    {
        var varNames = ['instanceLabel', 'typeLabel', 'instancePage', 'typePage', 'instanceUri', 'typeUri', 'lon', 'lat'];
        _(varNames).each(function(varName) {
            essentialTableMod.addColumn(varName);
        });
    }


    var geoConceptFactory = new sparql.ConceptFactoryFacetTreeConfig(facetTreeConfig);


    var conceptFalse = new sparql.Concept(sparql.ElementString.create('?s a <http://foo.bar>'), vs);

    var filterConceptFactory = new sparql.ConceptFactoryConst(conceptFalse)



    /**
     * Create a base concept (subject-concept) that is optionally constrained by a filter string (full text)
     * TODO We could port this to make use of sparql.KeywordSearchUtils
     */
    var createBaseConcept = function(filterString, baseVar) {
        var result;
        var vs = baseVar || rdf.NodeFactory.createVar('s');
        if(filterString == null || filterString === '') {
            result = sparql.ConceptUtils.createSubjectConcept(vs);
        }
        else {
            var vo = rdf.NodeFactory.createVar('bcl'); // bif contains label
            var evo = new sparql.ExprVar(vo);

            var no = rdf.NodeFactory.createPlainLiteral(filterString);
            var eno = sparql.NodeValueUtils.makeNode(no);

            //var es = new sparql.ExprVar(vs);
            var element =
                new sparql.ElementGroup([
                    new sparql.ElementTriplesBlock([
                        new rdf.Triple(vs, vocab.rdfs.label, vo)
                    ]),
                    new sparql.ElementFilter(
                        new sparql.E_Function('bif:contains', [evo, eno])
                    )
                ]);

            result = new sparql.Concept(element, vs);
        }

        return result;
    };

    $scope.setBaseConcept = function(filterString) {

        var baseConcept = createBaseConcept(filterString);

        facetTreeConfig.getFacetConfig().setBaseConcept(baseConcept);

        if(filterString == null || filterString === '') {
            $scope.app.baseConceptFilterString = null;
        } else {
            $scope.app.baseConceptFilterString = filterString;
        }
    };


    $scope.tableContext = {};

//         var argh = $scope;

    // TODO This method should go to a different tableContext
    $scope.tableContext.setGeoPath = function(path) {
        $scope.active.geoConceptFactory.setPath(path);
    };

    $scope.tableContext.isGeoPathActive = function(path) {
        var p = $scope.active.geoConceptFactory.getPath();

        var result = p ? p.equals(path) : false;
        return result;
        //$scope.active.geoConceptFactory.setPath(path);
    };


    $scope.tableContext.menuOptions = AppConfig.tableConfig.createMenuOptions($scope);


    /**
     * The facet tree plugin for the linking facets to the result table
     */
    var visibleControls = new util.HashSet();
    taggerMap.controls = new facete.ItemTaggerMembership(visibleControls);

    $scope.facetTreePluginContext = {
        toggleControls: function(path) {
            if(path) {
                util.CollectionUtils.toggleItem(visibleControls, path);
            }
        },

        toggleTableLink: function(path) {
            if(tableConfigFacet) {
                tableConfigFacet.togglePath(path);
            }

        },
        isLinkedToTable: function(path) {
            var tmp = new jassa.util.ArrayList(tableConfigFacet.getPaths());

            var result = tmp.contains(path);
            return result;
        }
    };

    $scope.facetTreePlugins = [
        '<button class="btn" ng-class="pluginContext.isLinkedToTable(item.path) ? \'btn-primary\' : \'btn-default visible-on-hover-child\'" href="" ng-click="pluginContext.toggleTableLink(item.path)"><span class="glyphicon glyphicon-list-alt"></span></button>'
    ];


    $scope.active.services.sparqlService = new service.SparqlServiceDummy();
    $scope.active.geoConceptFactory = geoConceptFactory;



    refreshDataSources();

    $scope.active.serviceConfigs = [];


    // TODO: Whenever the facet selection changes, we need to recreate the map data source service for the modified concept
    var createMapDataSource = function(sparqlService, geoMapFactory, concept, fillColor) {

        console.log('Concept: ' + concept, geoMapFactory);

        //Factory = geo.GeoMapFactoryUtils.createWktMapFactory('http://www.w3.org/2003/01/geo/wgs84_pos#Geometry', '<bif:st_intersects>', '<bif:st_geomFromText>');


        // The 'core' service from which to retrieve the initial data
        var bboxListService = new geo.ListServiceBbox(sparqlService, geoMapFactory, concept);

        // Wrap this service for augmenting (enriching) it with labels
        // TODO Make dependent on scope.langs
        var lookupServiceLabels = sponate.LookupServiceUtils.createLookupServiceNodeLabels(sparqlService, new sparql.LiteralPreference($scope.langs));
//        lookupServiceLabels = new service.LookupServiceTransform(lookupServiceLabels, function(doc, id) {
//            var result = {
//                shortLabel: doc
//            };
//            return result;
//        });

        //var augmenterLabels = new service.AugmenterLookup(lookupServiceLabels);
        //bboxListService = new service.ListServiceAugmenter(bboxListService, augmenterLabels);
        bboxListService = new service.ListServiceTransformItems(bboxListService, function(entries) {
            var keys = _(entries).pluck('key');
            return lookupServiceLabels.lookup(keys).then(function(map) {
                entries.forEach(function(entry) {
                    var labelInfo = map.get(entry.key);
                    entry.val.shortLabel = labelInfo ? labelInfo.displayLabel : '(no label)';
                });

                return entries;
            });
        });

        bboxListService = new service.ListServiceTransformItem(bboxListService, function(entry) {

            var data = {
        // Also add style information
        //var lookupServiceStyle = new service.LookupServiceConst({
            fillColor: fillColor,
            fontColor: fillColor,
               strokeColor: fillColor,

            stroke: true,
            strokeLinecap: 'round',
            strokeWidth: 100,
            pointRadius: 12,
            labelAlign: 'cm',

            config: {
                conceptFactory: geoConceptFactory
            }
            };

            //var r = _(entry.val).extend(data);
            // Make a copy to avoid potentially corrupting caches

//            var r = {
//                key: entry.key,
//                val: _({}).extend(entry.val, data)
//            };

            _(entry.val).extend(data);

            return entry;
        });

        //var augmenterStyle = new service.AugmenterLookup(lookupServiceStyle);
        //bboxListService = new service.ListServiceAugmenter(bboxListService, augmenterStyle);

        // Wrap the list service with clustering support
        //var result = new geo.DataServiceBboxCache(bboxListService, 1500, 500, 2);
        var result = new geo.DataServiceBboxCache(bboxListService, 500, 300, 2);

        return result;
    };


    /**
     * Init of derived attributes
     *
     */


    // On startup, show the list of rdf:types
    // For facet tree:
    $scope.active.path = facete.Path.parse(vocab.rdf.type.getUri());
    $scope.active.targetPath = facete.Path.parse(vocab.rdf.type.getUri());

    // For facet list:
    $scope.active.breadcrumb = {
        pathHead: new jassa.facete.PathHead(new jassa.facete.Path()),
        property: jassa.vocab.rdf.type.getUri()
    };


    /**
     * Concept Path Finding
     */


    var findConceptPaths = function(sourceConcept, targetConcept) {
        var conceptPathFinder = $scope.active.conceptPathFinder;
        if(!conceptPathFinder) {
            var deferred = jQuery.Deferred();
            deferred.resolve([]);
            return deferred.promise();
        }

        var promise = conceptPathFinder.findPaths(sourceConcept, targetConcept);
        var result = $q.when(promise).then(function(paths) {//sponate.angular.bridgePromise(promise, $q.defer(), $rootScope, function(paths) {

            //console.log('Paths' + JSON.stringify(paths) + ' Source: ' + sourceConcept + ' Target: ' + targetConcept);
            var tmp = _(paths).map(function(path) {

                var pathName = path.toString();
                if(pathName === '') {
                    pathName = '(empty path)';
                }

                var r = {
                    name: pathName,
                    path: path
                };
                return r;
            });

            return tmp;
        }, function(e) {
            throw e;
        });

        return result;
    };



    dddi = $dddi($scope);


    // Objects being wired up here
    // - sparqlCache
    // - services.sparqlService
    // - services.conceptPathFinder
    // - services.tableGeoLink
    // - lookupServiceNodeLabels
    // - lookupServicePathLabels
    // - lookupServiceConstraintLabels
    // -

    dddi.register('active.services.labelLiteralPreference', [ '=langs',
        function(langs) {
            var r = new sparql.LiteralPreference(langs);
            return r;
        }]);

    dddi.register('active.services.sparqlCache', [ '=config.dataService', '=editCounter',
        function(sparqlService) {
            sparqlCacheSupplier.invalidate();

            var r = $scope.sparqlCacheSupplier.getCache(sparqlService.serviceIri, sparqlService.defaultGraphIris);
            return r;
        }]);


    //  '=editCounter',
    dddi.register('active.services.updateService', [ '=active.config.dataService',
        function(serviceConfig) {
            var r = new jassa.service.SparqlUpdateHttp(serviceConfig.serviceIri, serviceConfig.defaultGraphIris);
            return r;
        }]);


    dddi.register('active.services.sparqlService', [ '=active.config.dataService', '?=active.config.sparqlProxyUrl', '?active.services.sparqlCache',
        function(serviceConfig, sparqlProxyUrl, sparqlCache) {
            //var cache = sparqlCacheSupplier ? sparqlCacheSupplier.getCache(serviceIri, defaultGraphIris) : null;
//console.log('Recreated sparql service');

            var base = sparqlProxyUrl == null
                ? jassa.service.SparqlServiceBuilder.http(serviceConfig.serviceIri, serviceConfig.defaultGraphIris, {type: 'POST'})
                : jassa.service.SparqlServiceBuilder.http(sparqlProxyUrl, serviceConfig.defaultGraphIris, {type: 'POST'}, {'service-uri': serviceConfig.serviceIri})
                ;

            if(sparqlCache) {
                // TODO Reuse prior request cache?
                var requestCache = null; //new jassa.service.RequestCache(null, sparqlCache);
                base = base.cache(requestCache);
            }

            var r = base.virtFix().paginate(1000).pageExpand(100).create();

            //console.log('Sparql service', serviceIri, defaultGraphIris);
            return r;
        }]);

    dddi.register('active.services.lookupServiceNodeLabels', [ 'active.services.sparqlService', 'active.services.labelLiteralPreference',
        function(sparqlService, literalPreference) {
            //var literalPreference = active.services.labelLiteralPreference; //new sparql.LiteralPreference($scope.langs);
            var r = sponate.LookupServiceUtils.createLookupServiceNodeLabels(sparqlService, literalPreference, 20 /* predicates */);
            //r = new service.LookupServiceCache(r);
            return r;
        }]);

    dddi.register('active.services.lookupServicePathLabels', [ 'active.services.lookupServiceNodeLabels',
        function(lookupServiceNodeLabels) {
            var r = new facete.LookupServicePathLabels(lookupServiceNodeLabels);
            return r;
        }]);

    dddi.register('active.services.lookupServiceConstraintLabels', [ 'active.services.lookupServiceNodeLabels', 'active.services.lookupServicePathLabels',
        function(lookupServiceNodeLabels, lookupServicePathLabels) {
            var r = new facete.LookupServiceConstraintLabels(lookupServiceNodeLabels, lookupServicePathLabels);
            return r;
        }]);

    dddi.register('active.services.listServiceConstraintLabels', ['active.services.lookupServiceConstraintLabels', 'ObjectUtils.hashCode(active.config.facetTreeConfig.getFacetConfig().getConstraintManager())',
        function(lookupServiceConstraintLabels) {

            var cm = $scope.active.config.facetTreeConfig.getFacetConfig().getConstraintManager();
            var constraints = cm != null ? cm.getConstraints() : [];

            var promise = lookupServiceConstraintLabels.lookup(constraints).then(function(map) {

                var entries = constraints.map(function(constraint) {
                    var label = map.get(constraint);

                    var r = {
                        key: constraint,
                        val: {
                            constraint: constraint,
                            label: label
                        }
                    };

                    return r;
                });

                var filterSupplierFn = function(searchString) {
                    var result;

                    if(searchString != null) {
                        var re = new RegExp(searchString, 'mi');

                        result = function(entry) {
                            var m1 = re.test(entry.val.label);
                            return m1;
                        };
                    } else {
                        result = function(entry) { return true; };
                    }

                    return result;
                };

                var r = new jassa.service.ListServiceArray(entries, filterSupplierFn);
                return r;
            });

            promise.then(function(ls) {
               ls.fetchItems().then(function(entries) {
                   console.log('WEEE: ', entries);
               });
            });
            return promise;
        }]);


//    dddi.register('active.config.constraintManager', ['active.config.facetConfig',
//        function() {
//
//        }]);


    dddi.register('active.services.facetService', [ 'active.services.sparqlService', 'ObjectUtils.hashCode(active.config.facetTreeConfig.getFacetConfig())', 'active.services.labelLiteralPreference',
        function(sparqlService, facetConfigHash, labelLiteralPreference) {
            var facetConfig = $scope.active.config.facetTreeConfig.getFacetConfig();

            var r = jassa.facete.FacetServiceBuilder
                .core(sparqlService, facetConfig)
                .labelConfig(labelLiteralPreference)
                .index()
                //.pathToTags(pathToTags)
                //.tagFn(tagFn)
                .create();

            return r;
        }]);

    // TODO We could actually depend on the nodeLabel lookupService
    // But maybe its ok to just depend on the labelLiteralPreference
    dddi.register('active.services.facetValueService', [ 'active.services.sparqlService', 'ObjectUtils.hashCode(active.config.facetTreeConfig.getFacetConfig())', 'active.services.labelLiteralPreference',
        function(sparqlService, facetConfigHash, labelLiteralPreference) {
            var facetConfig = $scope.active.config.facetTreeConfig.getFacetConfig();

            var facetValueServiceRowLimit = 5000000;

            //var constraintManager = facetConfig.getConstraintManager();

            var r = jassa.facete.FacetValueServiceBuilder
                .core(sparqlService, facetConfig, facetValueServiceRowLimit)
                .labelConfig(labelLiteralPreference)
                .constraintTagging()
                .create();

            return r;
        }]);


    //dddi.register('')

//    dddi.register('active.targetGeoPaths', [
//        function() {
//
//        }]);


//    var testExpr = 'active.config.geoConceptFactory.createConcept().toString()';
//    $scope.$watch(testExpr, function(val) {
//       console.log('testExpr: ' + testExpr, val);
//    });

    dddi.register('active.dataSources', [ 'active.services.sparqlService', 'active.config.mapConfig.geoMode.mapFactory', 'active.geoConceptFactory.createConcept().toString()',
        function(sparqlService, mapFactory, geoConceptStr) {
            var geoConcept = $scope.active.geoConceptFactory.createConcept();
            // TODO Do caching based on the geoConcept

            var r = [
                createMapDataSource(sparqlService, mapFactory, geoConcept, '#CC0020')
            ];
            return r;
        }]);

    dddi.register('active.services.conceptPathFinder', [ '=active.config.conceptPathFinderApiUrl', '=active.config.dataService', '?=active.config.joinSummaryService', 'active.config.mapConfig.geoMode.geoConcept',
        function(conceptPathFinderApiUrl, dataService, jsService, geoConcept) {
            var r = new client.ConceptPathFinderApi(conceptPathFinderApiUrl, dataService.serviceIri, dataService.defaultGraphIris, jsService.serviceIri, jsService.defaultGraphIris);
            return r;
        }]);

    // TODO active.services.sourceConcept may not the best target as a concept is not really a service
    dddi.register('active.services.sourceConcept', ['ObjectUtils.hashCode(active.config.facetTreeConfig)',
        function() {
            var tmp = new sparql.ConceptFactoryFacetTreeConfig($scope.active.config.facetTreeConfig);
            var r = tmp.createConcept();
            return r;
        }]);

    dddi.register('active.tableGeoLink', ['active.services.conceptPathFinder', 'active.services.sourceConcept', 'active.config.mapConfig.geoMode.geoConcept', 'active.services.lookupServiceNodeLabels', 'active.services.lookupServicePathLabels',
        function(conceptPathFinder, sourceConcept, targetConcept, lookupServiceNodeLabels, lookupServicePathLabels) {

            // Helper function von the geolink table
            var createTableConfigGeoLink = function(tableConfig, conceptPathFinder, sourceConcept, targetConcept) {
                return {
                    tableServiceSupplier: function(config) {

                        //var services = $scope.active.services;

                        // TODO We should wrap a cache here?
                        var sparqlService = conceptPathFinder.createSparqlService(config.sourceConcept, config.targetConcept)

                        var tableService = new service.TableServiceQuery(sparqlService, config.query);
                        tableService = new service.TableServiceFacet(tableService, config.tableConfig, lookupServiceNodeLabels, lookupServicePathLabels);

                        var pathColId = config.tableConfig.getColIdForPath(new facete.Path());
                        var labelColId = config.tableConfig.getColIdForPath(facete.Path.parse(vocab.rdfs.label.getUri()));

                        tableService = new service.TableServiceGeoLink(tableService, lookupServicePathLabels, pathColId, labelColId);

                        return tableService;
                    },
                    configSupplier: function() {

                        var tableMod = tableConfig.getTableMod();
                        var conceptFactory = new ConceptFactoryTableConfigFacet(tableConfig);
                        var elementFactory = new facete.ElementFactoryConceptFactory(conceptFactory);
                        var queryFactory = new facete.QueryFactoryTableMod(elementFactory, tableMod);

                        var r = {
                            query: queryFactory.createQuery(),
                            tableConfig: tableConfig,

                            conceptPathFinder: conceptPathFinder,
                            sourceConcept: sourceConcept,
                            targetConcept: targetConcept
                        };
                        return r;
                    },
                    tableMod: tableConfig.getTableMod(),
                    cellRendererSupplier: function() {
                        var html;

                        if(this.cell.path) {
                            html = '<a href="" ng-class="context.isGeoPathActive(cell.path) ? \'label label-primary\' : \'\'" ng-click="context.setGeoPath(cell.path)" title="{{cell.node.toString()}}" ng-bind-html="cell.displayLabel"></a>';
                        }
                        else {
                            html = '<span ng-bind-html="cell.displayLabel"></span>';
                        }

                        return html;
                    }
                }
            };

            // Note: tableConfigGeoLink is statically configured
            var r = createTableConfigGeoLink(tableConfigGeoLink, conceptPathFinder, sourceConcept, targetConcept);
            return r;
        }]);


    dddi.register('active.pathLabel', [ 'active.path', 'active.services.lookupServicePathLabels',
        function(path, lookupServicePathLabels) {
            var promise = lookupServicePathLabels.lookup([path]);

            var r = promise.then(function(map) {//sponate.angular.bridgePromise(promise, $q.defer(), $scope, function(map) {
                var s = map.get(path);
                return s;
            });

            return r;
            //return $scope.active.pathLabel;
        }]);



    /**
     *  Table Views
     *
     *  TODO Make use of dddi
     */
    $scope.$watchCollection('[active.services.sparqlService, ObjectUtils.hashCode(active.config.facetTreeConfig), ObjectUtils.hashCode(active.config.tableConfigFacet), active.services.lookupServiceNodeLabels, active.services.lookupServicePathLabels]',
        function() {
            if(!$scope.active || !$scope.active.config || !$scope.active.services) {
                return;
            }

            var sparqlService = $scope.active.services.sparqlService;
            var facetTreeConfig = $scope.active.config.facetTreeConfig;
            var tableConfigFacet = $scope.active.config.tableConfigFacet;
            var lookupServiceNodeLabels = $scope.active.services.lookupServiceNodeLabels;
            var lookupServicePathLabels = $scope.active.services.lookupServicePathLabels;


            if(!sparqlService || !facetTreeConfig || !tableConfigFacet || !lookupServiceNodeLabels || !lookupServicePathLabels) {
                return;
            }

            /*
             * <- Facet Tree 'Link-Facet-To-Table' Plugin
             */

            // TODO This could be written with function composition rather than objects
            // But for this we would first have to convert the factories to operations on functions
//            var conceptFactory = new sparql.ConceptFactoryFacetTreeConfig(facetTreeConfig);
//
//            var facetConfig = facetTreeConfig.getFacetConfig();

            var facetConceptFactory = new sparql.ConceptFactoryFacetTreeConfig(facetTreeConfig);
            var facetElementFactory = new facete.ElementFactoryConceptFactory(facetConceptFactory);


            var tableMod = tableConfigFacet.getTableMod();

            var dataConceptFactory = new ConceptFactoryTableConfigFacet(tableConfigFacet);
            var dataElementFactory = new facete.ElementFactoryConceptFactory(dataConceptFactory);
            var filterElementFactory = new facete.ElementFactoryConceptFactory(filterConceptFactory);

            //var services = $scope.active.services;


            var createTableConfig = function(queryFactory, tableConfigFacet, tableMod) {
                return {
                    tableServiceSupplier: function(config) {
                        var query = config.query;
                        var tableService = new service.TableServiceQuery(sparqlService, query);
                        var result = new service.TableServiceFacet(tableService, tableConfigFacet, lookupServiceNodeLabels, lookupServicePathLabels);

                        return result;
                    },
                    configSupplier: function() {
                        var r = {
                            query: queryFactory.createQuery(),
                            tableConfigFacet: tableConfigFacet
                        };
                        return r;
                    },
                    tableMod: tableMod,
                    cellRendererSupplier: function() {

                        var html =
                            '<span title="{{cell.node.toString()}}" ng-bind-html="cell.displayLabel"></span>' +
                            '<span style="cursor: pointer;" ng-context-menu="context.menuOptions" class="show-on-hover-child glyphicon glyphicon-asterisk"></span>';

                        return html;
                    }
                };
            };

            var allElementFactory = new sparql.ElementFactoryCombine(true, [dataElementFactory, facetElementFactory]);
            var allQueryFactory = new facete.QueryFactoryTableMod(allElementFactory, tableMod);


            $scope.active.tableFacetAll = createTableConfig(allQueryFactory, tableConfigFacet, tableMod);


            // NOTE We assume the data and filter concept share the same variables
            var selectionElementFactory = new sparql.ElementFactoryCombine(true, [dataElementFactory, filterElementFactory]);
            var selectionQueryFactory = new facete.QueryFactoryTableMod(selectionElementFactory, tableMod);

            $scope.active.tableFacetSelection = createTableConfig(selectionQueryFactory, tableConfigFacet, tableMod);



            var createEssentialTableConfig = function(dataElementFactory, filterConceptFactory, tableMod) {

                var filterElementFactory = new facete.ElementFactoryConceptFactory(filterConceptFactory);

                var elementFactory = new sparql.ElementFactoryCombine(true, [dataElementFactory, filterElementFactory]);
                var queryFactory = new facete.QueryFactoryTableMod(elementFactory, tableMod);


                var result = {
                    tableServiceSupplier: function(config) {
                        var query = config.query;
                        var tableService = new service.TableServiceQuery(sparqlService, query);
                        tableService = new service.TableServiceNodeLabels(tableService, lookupServiceNodeLabels);

                        //var result = new service.TableServiceFacet(tableService, tableConfigFacet, services.lookupServiceNodeLabels, services.lookupServicePathLabels);

                        return tableService;
                    },
                    configSupplier: function() {
                        var r = {
                            query: queryFactory.createQuery(),
                        };

                        //console.log('ESSENTIAL QUERY' + r.query);

                        return r;
                    },
                    tableMod: tableMod,
                    cellRendererSupplier: function() {

                        var html =
                            '<span title="{{cell.node.toString()}}" ng-bind-html="cell.displayLabel"></span>' +
                            '<span style="cursor: pointer;" ng-context-menu="context.menuOptions" class="show-on-hover-child glyphicon glyphicon-asterisk"></span>';

                        return html;
                    }
                };

                return result;
            };

            var varMap = new util.HashMap();
            var vs = rdf.NodeFactory.createVar('s');
            var viu = rdf.NodeFactory.createVar('instanceUri');
            varMap.put(vs, viu);

            var tmpFilterConceptFactory = new sparql.ConceptFactoryRename(filterConceptFactory, varMap);
            var tmpFacetConceptFactory = new sparql.ConceptFactoryRename(facetConceptFactory, varMap);

            $scope.active.tableEssentialAll = createEssentialTableConfig(essentialDataElementFactory, tmpFacetConceptFactory, essentialTableMod);
            $scope.active.tableEssentialSelection = createEssentialTableConfig(essentialDataElementFactory, tmpFilterConceptFactory, essentialTableMod);



            // Resource selection
            {

                var varMap = new util.HashMap();
                var vs = rdf.NodeFactory.createVar('s');
                var viu = rdf.NodeFactory.createVar('subject');
                varMap.put(vs, viu);

                var tmpFilterConceptFactory = new sparql.ConceptFactoryRename(filterConceptFactory, varMap);


                var dataElement = sparql.ElementString.create("?subject ?predicate ?object");
                var dataElementFactory = new sparql.ElementFactoryConst(dataElement);


                var resourceTableMod = new facete.TableMod();

                {
                    var varNames = ['subject', 'predicate', 'object'];
                    _(varNames).each(function(varName) {
                        resourceTableMod.addColumn(varName);
                    });
                }


                $scope.active.tableResourceSelection = createEssentialTableConfig(dataElementFactory, tmpFilterConceptFactory, resourceTableMod);
            }

        });


//    $scope.setDataSource = function(item) {
//        alert(JSON.stringify(item));
//    };




    $scope.active.dataSources = [];


    var serviceConfigs = $scope.active.serviceConfigs
    $scope.active.config = serviceConfigs.length === 0 ? null : serviceConfigs[0];




    $scope.selectFacet = function(path) {
        $scope.active.path = path;
    };

    $scope.selectTargetFacet = function(path) {
        $scope.active.targetPath = path;
    };

    $scope.selectGeom = function(data) {
        console.log('Data selected: ', data);

        var geoConceptFactory = data.config.conceptFactory;

        var geoConcept = geoConceptFactory.createConcept();
        var vs = geoConcept.getVar();
        var rootVar = geoConceptFactory.getFacetTreeConfig().getFacetConfig().getBaseConcept().getVar();


        //alert('Select: ' + JSON.stringify(data));
        var node = data.id;
        var ev = new sparql.ExprVar(vs);
        var nodeValue = sparql.NodeValueUtils.makeNode(node);
        var expr = new sparql.E_Equals(ev, nodeValue);
        var elementFilter = new sparql.ElementFilter(expr);

        var elements = geoConcept.getElements().slice(0);
        elements.push(elementFilter);


        var concept = sparql.Concept.createFromElements(elements, rootVar);

        //alert('SelectConcept: ' + concept);

        filterConceptFactory.setConcept(concept);

        if(!$scope.$$phase) {
            $scope.$apply();
        }
    };

    $scope.unselectGeom = function(data) {
        //alert('Unselect: ' + JSON.stringify(data));
        filterConceptFactory.setConcept(conceptFalse);
        if(!$scope.$$phase) {
            $scope.$apply();
        }
    };



    $scope.searchResults = [];

    $scope.doSearch = function(searchString) {
        $scope.app.search.show = true;
        $scope.app.search.isOpen = true;

        var ajaxSpec = {
            crossDomain: true,
            url: 'http://nominatim.openstreetmap.org/search/',
            dataType: 'json',
            traditional: 'true',
            data: {
                format: 'json',
                q: searchString
            }
        };

        var promise = jQuery.ajax(ajaxSpec).pipe(function(items) {
            _(items).each(function(item) {
                var nameParts = item.display_name.split(',');

                item.primaryName = nameParts[0];
                item.description = nameParts[1];
            });

            return items;
        });

        $q.when(promise).then(function(data) {//sponate.angular.bridgePromise(promise, $q.defer(), $rootScope, function(data) {
            $scope.searchResults = data;
        }, function(e) {
            throw e;
        });
    };

    $scope.active.mapConfig = {};

    $scope.selectSearchResult = function(item) {
        $scope.active.mapConfig.center = {lon: item.lon, lat: item.lat},
        $scope.active.mapConfig.zoom = 13;
    };



    /**
     * Export functionality
     */

    $scope.notifications = [];


    var metaSparqlService = new service.SparqlServiceHttp('api/export-status/sparql', []);
    var metaStore = new sponate.StoreFacade(metaSparqlService, AppConfig.batch.prefixes);

    metaStore.addMap({
        name: 'sparqlExports',
        template: [{
            id: '?je',
            context: '?jec',
            exitCode: '?jeec',
            status: '?jes',
            steps: [{
                id: '?se',
                label: '?sel',
                context: '?sec'
            }]
        }],
        from: '{' + CannedQueries.jobExecutionStatus + '}'
    });



    /**
     * Index the map of a spring batch object
     * this is for spring batch ~2.2
     */
    var indexBatchMapOld = function(map) {
        var result;
        var entry = map ? map.entry : null;

        if(!entry) {
            result = {};
        }
        else if(_(entry).isArray()) {
            result = _(entry).indexBy('string');
        }
        else {
            result = {};
            var key = entry['string'];
            result[key] = entry;
        }

        return result;
    };

    var indexBatchMap = function(entries) {
        var result = {};
        entries.forEach(function(entry) {
            var tmp = indexBatchMapOld(entry);
            _(result).extend(tmp);
        });
        return result;
    };


    var processJobStatus = function(item) {
        var jobContext = JSON.parse(item.context);

        var jobMap = indexBatchMap(jobContext.map);
        console.log(jobMap);

        var tmp = jobMap['DataCountTasklet.count'];
        var countStr = tmp ? tmp['long'] : null;


        var maxItemCount = countStr != null ? parseInt(countStr) : null;
        var itemCount = 0;

        _(item.steps).each(function(step) {
            if(step.label === 'dataFetchStep') {
                var stepContext = JSON.parse(step.context);
                var stepMap = indexBatchMap(stepContext.map);

                itemCount = parseInt(stepMap['FlatFileItemWriter.written']['long']);
            }
        });

        var isRunning = item.status !== 'STOPPED' && item.status !== 'COMPLETED' && item.status !== 'FAILED';

        var percentage = maxItemCount == null
            ? 0
            : (maxItemCount === 0 ? 100 : Math.floor(itemCount / maxItemCount * 100));

        var result = {
            id: item.id, //.slice(1, -1),
            isRunning: isRunning,
            isCounting: isRunning && maxItemCount == null,
            isRetrieving: isRunning && maxItemCount != null,
            isFinished: !isRunning,
            isFailed: !isRunning && item.exitCode !== 'COMPLETED',
            isSucceeded: !isRunning && item.exitCode === 'COMPLETED',
            progress: {
                current: itemCount,
                max: maxItemCount,
                percentage: percentage
            }
        };

        //alert(JSON.stringify(result));
        return result;
    };


    var watchExport = function(jobExecutionUri, status) {
        var v = rdf.NodeFactory.createVar('je');
        var elementFilter = new sparql.ElementFilter(new sparql.E_Equals(new sparql.ExprVar(v), sparql.NodeValueUtils.makeNode(rdf.NodeFactory.createUri(jobExecutionUri))));

        var element = new sparql.ElementGroup([
            new sparql.ElementTriplesBlock([
                new rdf.Triple(v, rdf.NodeFactory.createVar('ppp'), rdf.NodeFactory.createVar('ooo'))
            ]),
            elementFilter
        ]);

        var concept = new sparql.Concept(element, v);

        var promise = metaStore.sparqlExports.find().concept(concept).list();
        $q.when(promise).then(function(data) {

            var item = data[0].val;

            //alert('yay' + JSON.stringify(item));

            var jobStatus = processJobStatus(item);

            status.jobStatus = jobStatus;
            //applyRootScope($scope);

            console.log('Still alive: ', jobStatus.isRunning);

            if(jobStatus.isRunning) {
                $timeout(function() {
                    watchExport(jobExecutionUri, status);
                }, 3000);
            }

        }, function(e) {
            //alert('fail');
            throw e;
        });
    };


    $scope.exportFacetTable = function(config) {
//        var config = {
//                query: queryFactory.createQuery(),
//                tableConfigFacet: tableConfigFacet
//            };

        var query = config.query;
        var tableConfigFacet = config.tableConfigFacet;

        var lookupServicePathLabels = $scope.active.services.lookupServicePathLabels;

        var paths = tableConfigFacet.getPaths();

        // Lookup column heading labels based on the paths
        var result = lookupServicePathLabels.lookup(paths).then(function(map) {

            var varMap = new jassa.util.HashMap();
            paths.forEach(function(path) {
                var colId = tableConfigFacet.getColumnId(path);
                var a = rdf.NodeFactory.createVar(colId);

                var label = map.get(path) || colId;
                var b = rdf.NodeFactory.createVar(label);

                if(!a.equals(b)) {
                    varMap.put(a, b);
                }
            });

            var r = $scope.exportQuery(query, varMap);
            return r;
            // Set up the variable mapping
        });

        return result;
    };

    /**
     * varMap can be used to rename variables (which may include special symbols and white spaces
     *
     */
    $scope.exportQuery = function(query, varMap) {
        var ds = $scope.active.config.dataService;

        var status = {
            msg: 'Export started.',
            rename: encodeURIComponent(JSON.stringify(varMapToJson(varMap || new jassa.util.HashMap())))
        };

        $scope.notifications.push(status);

        var exporter = new Exporter(AppConfig.exportApiUrl, ds.serviceIri, ds.defaultGraphIris);

        var promise = exporter.exportQuery(query);
        $q.when(promise).then(function(data) {
            //$scope.notifications.push({msg: 'Export successfully started: ' + data.id});
            status.msg = 'Export successfully started: ' + data.id;
            //applyRootScope($scope);

            watchExport(data.id, status);

        }, function(e) {
            status.msg = 'Export failed: '; // + data.id;
            //applyRootScope($scope);
            //throw e;
        });


    };

}]);
