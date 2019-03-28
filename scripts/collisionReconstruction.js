geotab.addin.collisionReconstruction = function (api, state) {
    "use strict";

    var vin = {},
        accident = {},
        currentDevice = {},
        devices = [],
        credentials = {},
        accidentAutocomplete = null,
        minDate = new Date(Date.UTC(1986, 0, 1)),
        userInputVehicleType = null,
        mapHeight = "0px",
        isMetric = true,
        userTimezone = "",
        dateTo = "",
        dateFrom = "",
        accidentWeb = document.getElementById("deviceId"),
        waiting = document.getElementById("waiting"),
        inputDateStart = document.getElementById("input-start-date"),
        inputDateEnd = document.getElementById("input-end-date"),
        showHistoricDevices = document.getElementById("showHistoricDevices"),
        searchButton = document.getElementById("collisionReconstructionSearchButton"),
		exportPdfButton = document.getElementById("collisionReconstructionExportPdfButton"),
		elAddin,

        datePickerStart = $("#input-start-date").datetimepicker({
            controlType: "select",
            changeYear: true,
            changeMonth: true,
            showOtherMonths: true,
            beforeShow: function (input, inst) {
                var rect = input.getBoundingClientRect();
                setTimeout(function () {
                    inst.dpDiv.css({top: rect.top - 160, left: rect.left - 225});
                }, 0);
            }
        }),

        datePickerEnd = $("#input-end-date").datetimepicker({
            controlType: "select",
            changeYear: true,
            changeMonth: true,
            showOtherMonths: true,
            beforeShow: function (input, inst) {
                var rect = input.getBoundingClientRect();
                setTimeout(function () {
                    inst.dpDiv.css({top: rect.top - 160, left: rect.left - 225});
                }, 0);
            }
        }),

        initialize = function () {
            accidentWeb.removeAttribute("disabled");
            getDevicesCurrentUser();

            api.getSession(function (session, server) {
                credentials.database = session.database;
                credentials.server = server;
            });
			document.title = state.translate('Collision Reconstruction (BETA)');
			document.getElementById("vehicleLabel").textContent = state.translate('Vehicle');
			document.getElementById("selectVehicleLabel").textContent = state.translate('Select Vehicle Type');
			document.getElementById("select-vehicle-type-none").textContent = state.translate('Let Geotab Decide');
			document.getElementById("select-vehicle-type-car").textContent = state.translate('Car');
			document.getElementById("select-vehicle-type-van").textContent = state.translate('Van');
			document.getElementById("select-vehicle-type-pickup").textContent = state.translate('Pickup');
			document.getElementById("select-vehicle-type-truck").textContent = state.translate('Truck');
			document.getElementById("startLabel").textContent = state.translate('Start date');
			document.getElementById("endLabel").textContent = state.translate('End date');
			accidentWeb.textContent = state.translate('Enter vehicle name...');
			
            var now = new Date(),
                dd = now.getDate(),
                mm = now.getMonth() + 1,
                yy = now.getFullYear();

            if (dd < 10) {
                dd = "0" + dd;
            }

            if (mm < 10) {
                mm = "0" + mm;
            }

            inputDateStart.value = mm + "/" + dd + "/" + yy + " " + "00:00";
            inputDateEnd.value = mm + "/" + dd + "/" + yy + " " + "23:59";

            adjustDisplayWidth();
            window.addEventListener("resize", adjustDisplayWidth);
        },

        findAccident = function () {
            clear();
			console.log(inputDateStart);
            var deviceId = accidentWeb.getAttribute("data-device-id"),
                vehicleType = document.getElementById("select-vehicle-type");

                dateFrom = moment.tz(inputDateStart.value, "MM/DD/YYYY HH:mm", userTimezone).utc().format();
                dateTo = moment.tz(inputDateEnd.value, "MM/DD/YYYY HH:mm", userTimezone).utc().format();

            userInputVehicleType = vehicleType.options[vehicleType.selectedIndex].getAttribute("data-value");

            if (deviceId === null) {
                document.getElementById("results").innerHTML = "<div class='error'>" + state.translate('Please select a vehicle.') + "</div>";
            } else if (dateFrom > dateTo) {
                document.getElementById("results").innerHTML = "<div class='error'>" + state.translate('The start date cannot be after the end date. Please adjust the date range.') + "</div>";
            } else {
                showWaiting();
                getDeviceAndVIN(deviceId);
            }
        },
		
		exportPdf = function() {
			window.print();
		},

        getDeviceAndVIN = function (deviceId) {
            api.call("Get", {
                typeName: "Device",
                search: {id: deviceId},
                resultsLimit: 1
            }, function (result) {
                if (result.length === 0) {
                    document.getElementById("results").innerHTML = "<div class='error'>" + state.translate('Information about this vehicle could not be found.') + "</div>";
                    console.error("Failed to get device information for the chosen vehicle.");
                    hideWaiting();
                    return;
                }

                currentDevice = result[0];
                accident.vehicleType = userInputVehicleType;

                if (result[0].vehicleIdentificationNumber && result[0].vehicleIdentificationNumber !== "") {
                    decodeVin(currentDevice.vehicleIdentificationNumber);
                } else if (accident.vehicleType !== "none") {
                    getAccidentFault(currentDevice.id, dateFrom, dateTo);
                } else {
                    document.getElementById("results").innerHTML = "<div class='error'>" + state.translate('There is no VIN information for the selected vehicle. Please select a vehicle type and try again.') + "</div>";
                    hideWaiting();
                }
            }, function (e) {
                document.getElementById("results").innerHTML = "<div class='error'>" + state.translate('Could not retrieve vehicle information.') + "</div>";
                console.error("Failed to get device: ", e);
                hideWaiting();
            });
        },

        decodeVin = function (givenVin) {
            var vinArray = [givenVin];

            api.call("DecodeVins", {
                "vins": vinArray
            }, function (result) {
                vin = result[0] || {};
                if (accident.vehicleType === "none") {
                    accident.vehicleType = (vin.extraDetails) ? getVehicleType(vin.extraDetails) : "none";
                }

                if (accident.vehicleType === "none") {
                    document.getElementById("results").innerHTML = "<div class='error'>" + state.translate('A vehicle type could not be determined automatically for the selected vehicle. Please select a vehicle type and try again.') + "</div>";
                    hideWaiting();
                    return;
                }

                getAccidentFault(currentDevice.id, dateFrom, dateTo);
            }, function (e) {
                if (accident.vehicleType !== "none") {
                    getAccidentFault(currentDevice.id, dateFrom, dateTo);
                }
                else {
                    document.getElementById("results").innerHTML = "<div class='error'>" + state.translate('Could not retrieve VIN information.') + "</div>";
                    console.error("Failed to decode VIN: ", e);
                    hideWaiting();
                }
            });
        },

        getAccidentFault = function (deviceId, startDatetime, endDatetime) {
            api.call("Get", {
                "typeName": "FaultData",
                "search": {
                    "fromDate": startDatetime,
                    "toDate": endDatetime,
                    "deviceSearch": {"id": deviceId},
                    "diagnosticSearch": {"id": "diagnosticAccidentLevelAccelerationEventId"}
                }
            }, function (result) {
                if (result.length === 0) {
                    document.getElementById("results").innerHTML = "<div class='error'>" + state.translate('No collision was detected during this period of time.') + "</div>";
                    hideWaiting();
                    return;
                }

                var latestAccidentString = "",
                    latestAccidentDate = 0,
                    i;

                for (i = 0; i < result.length; i += 1) {
                    if (Date.parse(result[i].dateTime) > latestAccidentDate) {
                        latestAccidentDate = Date.parse(result[i].dateTime);
                        latestAccidentString = result[i].dateTime;
                    }
                }
                accident.dateTimeISO = latestAccidentString;
                accident.dateTime = new Date(latestAccidentString);
                getSpeed(deviceId, accident.dateTime);
            }, function (e) {
                document.getElementById("results").innerHTML = "<div class='error'>" + state.translate('Could not retrieve collision information.') + "</div>";
                console.error("Failed to get fault data: ", e);
                hideWaiting();
            });
        },

        // gets the LAST recorded speed aka most recent time stamp
        getSpeed = function (deviceId, accidentDate) {
            var startDatetime = new Date(accidentDate),
                endDatetime = new Date(accidentDate);

            startDatetime.setSeconds(startDatetime.getSeconds() - 30);
            accident.speedStartTime = startDatetime.toISOString();
            endDatetime.setSeconds(endDatetime.getSeconds() + 30);
            accident.speedEndTime = endDatetime.toISOString();

            api.call("Get", {
                "typeName": "LogRecord",
                "search": {
                    "fromDate": startDatetime,
                    "toDate": accidentDate,
                    "deviceSearch": {"id": deviceId}
                }
            }, function (result) {
                if (result.length === 0) {
                    accident.speed = state.translate('Unknown');
                    getAccelerometerData(deviceId, accidentDate);
                    return;
                }

                var gpsData = null, i;
                for (i = result.length - 1; i >= 0 && gpsData === null; i -= 1) {
                    if (result[i].id !== null) {
                        gpsData = result[i];
                    }
                }

                // backup in case it can't find a speed with an ID
                if (gpsData === null) {
                    for (i = result.length - 1; i >= 0 && gpsData === null; i -= 1) {
                        if (result[i].speed !== null) {
                            gpsData = result[i];
                        }
                    }
                }

                accident.speed = gpsData.speed;
                accident.longitude = gpsData.longitude;
                accident.latitude = gpsData.latitude;

                getAddress(accident.longitude, accident.latitude);

            }, function (e) {
                console.error("Failed to get speed log data: ", e);
                accident.speed = state.translate('Unknown');
                getAccelerometerData(deviceId, accidentDate);
            });
        },

        getAddress = function (longitude, latitude) {
            api.call("GetAddresses", {
                coordinates: [{
                    x: longitude,
                    y: latitude
                }]
            }, function (result) {
                if (result.length > 0) {
                    accident.address = result[0].formattedAddress;
                } else {
                    accident.address = state.translate('Address could not be rendered.');
                }

                getAccelerometerData(currentDevice.id, accident.dateTime);
            }, function (e) {
                console.error("Failed to get address data: ", e);
                accident.address = state.translate('Address could not be rendered.');

                getAccelerometerData(currentDevice.id, accident.dateTime);
            });
        },

        getAccelerometerData = function (deviceId, accidentDate) {
            var startDatetime = new Date(accidentDate),
                endDatetime = new Date(accidentDate);

            startDatetime.setSeconds(startDatetime.getSeconds() - 30);
            endDatetime.setSeconds(endDatetime.getSeconds() + 30);

            api.multiCall([["Get", {
                "typeName": "StatusData",
                "search": {
                    "fromDate": startDatetime,
                    "toDate": endDatetime,
                    "deviceSearch": {"id": deviceId},
                    "diagnosticSearch": {"id": "diagnosticAccelerationForwardBrakingId"}
                }
            }], ["Get", {
                "typeName": "StatusData",
                "search": {
                    "fromDate": startDatetime,
                    "toDate": endDatetime,
                    "deviceSearch": {"id": deviceId},
                    "diagnosticSearch": {"id": "diagnosticAccelerationSideToSideId"}
                }
            }]], function (result) {
                if (result[0].length === 0 || result[1].length === 0) {
                    document.getElementById("results").innerHTML = "<div class='error'>" + state.translate('Could not retrieve accelerometer information.') + "</div>";
                    console.error("No accelerometer data found; cannot continue processing results.");
                    hideWaiting();
                    return;
                }

                accident.xArray = result[0];
                accident.yArray = result[1];

                var index = getAbsolute(accident.xArray, accident.yArray);

                accident.x = accident.xArray[index].data;
                accident.y = accident.yArray[index].data;

                if (Math.abs(accident.x) < 18 && Math.abs(accident.y) < 18) {
                    document.getElementById("results").innerHTML = "<div class='error'>" + state.translate('No collision was detected during this period of time.') + "</div>";
                    hideWaiting();
                    return;
                }

                impactLogic(accident.x, accident.y);
            }, function (e) {
                document.getElementById("results").innerHTML = "<div class='error'>" + state.translate('There was an error getting accelerometer information. Please try again.') + "</div>";
                console.error("Failed to get accelerometer data: ", e);
                hideWaiting();
            });
        },

        getAbsolute = function (xArray, yArray) {
            var arrLength = xArray.length,
                total = 0,
                totalIndex = 0,
                currentTotal = 0,
                i;

            for (i = 0; i < arrLength; i += 1) {
                currentTotal = Math.abs(xArray[i].data) + Math.abs(yArray[i].data);

                if (currentTotal > total) {
                    total = currentTotal;
                    totalIndex = i;
                }
            }

            return totalIndex;
        },

        impactLogic = function (x, y) {
            //cannot continue if y is 0
            if (y === 0) {
                y = 1;
            }

            var accident_pos,
                tan = (Math.atan(x / y)) * (180 / Math.PI),
                h = Math.sqrt((Math.pow(x, 2)) + (Math.pow(y, 2))),
                sin = (Math.asin(y / h)) * (180 / Math.PI);

            if (tan > 0 && sin > 0 && Math.abs(tan) >= 22.5 && Math.abs(tan) < 67.5) {
                accident_pos = "BR";
            } else if ((tan >= 0 && sin >= 0 && Math.abs(tan) >= 67.5 && Math.abs(tan) <= 90) || (tan <= 0 && sin <= 0 && Math.abs(tan) >= 67.5 && Math.abs(tan) <= 90)) {
                accident_pos = "BC";
            } else if (tan < 0 && sin < 0 && Math.abs(tan) >= 22.5 && Math.abs(tan) < 67.5) {
                accident_pos = "BL";
            } else if ((tan <= 0 && sin <= 0 && Math.abs(tan) < 22.5) || (tan >= 0 && sin <= 0 && Math.abs(tan) < 22.5)) {
                accident_pos = "LC";
            } else if (tan > 0 && sin < 0 && Math.abs(tan) >= 22.5 && Math.abs(tan) < 67.5) {
                accident_pos = "FL";
            } else if ((tan >= 0 && sin <= 0 && Math.abs(tan) >= 67.5 && Math.abs(tan) <= 90) || (tan <= 0 && sin >= 0 && Math.abs(tan) >= 67.5 && Math.abs(tan) <= 90)) {
                accident_pos = "FC";
            } else if (tan < 0 && sin > 0 && Math.abs(tan) >= 22.5 && Math.abs(tan) < 67.5) {
                accident_pos = "FR";
            } else if ((tan <= 0 && sin >= 0 && Math.abs(tan) < 22.5) || (tan >= 0 && sin >= 0 && Math.abs(tan) < 22.5)) {
                accident_pos = "RC";
            }

            accident.pos = accident_pos;
            accident.imageString = "<h1>" + state.translate('Point of Impact') + "</h1><img src=https://www.geotab.com/geoimages/accident_image/" + accident.vehicleType + "/" + accident.vehicleType + accident.pos + ".png width=100% />";

            getTrip(currentDevice.id, accident.dateTime);
        },

        getTrip = function (deviceId, accidentDate) {
            var accidentAfter = new Date(accidentDate);

            api.call("Get", {
                "typeName": "Trip",
                "search": {
                    "fromDate": accidentDate,
                    "toDate": accidentDate,
                    "deviceSearch": {"id": deviceId},
                    "includeOverlappedTrips": true
                }
            }, function (result) {
                if (result.length === 0) {
                    accident.trip = state.translate('Unknown');
                    accident.driver = state.translate('Unknown Driver');
                    displayResults();
                    return;
                }

                accident.tripStart = result[0].start;
                accident.tripEnd = result[0].stop;
                accidentAfter.setDate(accidentAfter.getDate() + 1);
                accident.dayAfter = accidentAfter.toISOString();

                if (result[0].driver === "UnknownDriverId") {
                    accident.driver = state.translate('Unknown Driver');
                    displayResults();
                } else {
                    getUser(result[0].driver.id);
                }

            }, function (e) {
                accident.trip = state.translate('Unknown');
                accident.driver = state.translate('Unknown Driver');
                console.error("Failed to get trip data: ", e);
                displayResults();
            });
        },

        getUser = function (userId) {
            api.call("Get", {
                typeName: "User",
                search: {
                    id: userId
                }
            }, function (result) {
                if (result.length === 0) {
                    accident.driver = state.translate('Unknown Driver');
                    displayResults();
                    return;
                }

                accident.driver = result[0].firstName + (result[0].lastName && result[0].lastName !== "" ? (" " + result[0].lastName) : "") + " (" + result[0].name + ")";
                displayResults();
            }, function (e) {
                console.error("Failed to get user data: ", e);
                accident.driver = state.translate('Unknown Driver');
                displayResults();
            });
        },

        getVehicleType = function (vinObj) {
            var vehicleType, i;

            for (i = 0; i < vinObj.length; i += 1) {
                if (vinObj[i][0] === "VehicleTypeOut") {
                    vehicleType = assignVehicleType(vinObj[i][1]);
                    return vehicleType;
                }
            }
            return "none";
        },

        assignVehicleType = function (vinType) {
            var genericVehicleType;

            switch (vinType.toUpperCase()) {
            case "PASSENGER":
            case "PASSENGER CAR":
            case "P":
            case "MPV":
                genericVehicleType = "Car";
                break;
            case "TRUCK":
            case "BUS":
            case "INCOMPLETE":
            case "INCOMPLETE VEHICLE":
                genericVehicleType = "Truck";
                break;
            case "Truck - Pickup":
            case "PICKUP TRUCK":
            case "LDT":
                genericVehicleType = "Pickup";
                break;
            case "VAN":
                genericVehicleType = "Van";
                break;
            default:
                genericVehicleType = "none";
            }
            accident.vehicleType = genericVehicleType;
            return genericVehicleType;
        },

        clear = function () {
            document.getElementById("results").innerHTML = "";

            vin = {};
            accident = {};
            userInputVehicleType = null;
            currentDevice = {};
        },

        getDevicesCurrentUser = function (showHistoric) {
            var fromDate = showHistoric ? minDate : new Date().toISOString(),
                userName = "",
                calls;

            showWaiting();
            api.getSession(function (session) {
                userName = session.userName;
            });
            calls = [["Get", {
                typeName: "Device",
                search: {fromDate: fromDate}
            }], ["Get", {
                typeName: "User",
                search: {name: userName}
            }]];

            api.multiCall(calls, function (data) {
                if (data.length === 0) {
                    document.getElementById("results").innerHTML = "<div class='error'>" + state.translate('There was an error getting device information. Please refresh the page.') + "</div>";
                    console.error("Failed to get list of devices.");
                    hideWaiting();
                }

                devices = data[0];
                isMetric = data[1][0].isMetric;
                userTimezone = data[1][0].timeZoneId;
                updateVehiclesCombo();
                hideWaiting();
            }, function (e) {
                document.getElementById("results").innerHTML = "<div class='error'>" + state.translate('There was an error getting device information. Please refresh the page.') + "</div>";
                console.error("Failed to get list of devices: ", e);
                hideWaiting();
            });
        },

        showWaiting = function () {
            waiting.style.display = "block";
        },

        hideWaiting = function () {
            waiting.style.display = "none";
        },
		
		htmlEscape = function (str) {
			return String(str || "")
				.replace(/&/g, "&amp;")
				.replace(/"/g, "&quot;")
				.replace(/'/g, "&#39;")
				.replace(/</g, "&lt;")
				.replace(/>/g, "&gt;");
		},
		
        updateVehiclesCombo = function () {
            
            accidentAutocomplete && accidentAutocomplete.destroy();
            accidentAutocomplete = new autoComplete({
                selector: "#deviceId",
                minChars: 0,
                source: function (term, suggest) {
                    term = term.toLowerCase();
                    var choices = devices,
                        suggestions = [],
                        i;

                    for (i = 0; i < choices.length; i += 1) {
                        if (~choices[i].name.toLowerCase().indexOf(term)) {
                            suggestions.push({
                                name: htmlEscape(choices[i].name),
                                id: choices[i].id
                            });
                        }
                    }
                    suggest(suggestions);
                },
                renderItem: function (item, search) {
                    search = search.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&");
                    var re = new RegExp("(" + search.split(" ").join("|") + ")", "gi");

                    if (item && (accidentWeb.value.toLowerCase() === item.name.toLowerCase())) {
                        accidentWeb.setAttribute("data-device-id", item.id);
                    }

                    return "<div class='autocomplete-suggestion' data-device-name='" + htmlEscape(item.name) + "' data-device-id='" +
                            item.id + "' data-val='" + htmlEscape(search) + "'>" + item.name.replace(re, "<b>$1</b>") + "</div>";
                },
                onSelect: function (e, term, item) {
                    if ((accidentWeb.getAttribute("data-device-id") && (item.getAttribute("data-device-id") != accidentWeb.getAttribute("data-device-id"))) || accidentWeb.value !== item.getAttribute("data-device-name")) {
                        accidentWeb.setAttribute("data-device-id", item.getAttribute("data-device-id"));
                        accidentWeb.value = htmlEscape(item.getAttribute("data-device-name"));
                    }
					console.log(item);
                }
            });
        },

        displayResults = function () {
            //backup so map will not display incorrectly
            adjustDisplayWidth();

            var accidentDateArr = accident.dateTimeISO.split("T"),
                accidentDateAfterArr = (accident.dayAfter) ? accident.dayAfter.split("T") : [],
                accidentDateTime = moment(accident.dateTime).tz(userTimezone).format("dddd, MMMM DD, YYYY hh:mm:ss a"),
                accidentThirtyBefore = moment(accident.speedStartTime).tz(userTimezone).format("dddd, MMMM DD, YYYY hh:mm:ss a"),
                accidentThirtyAfter = moment(accident.speedEndTime).tz(userTimezone).format("dddd, MMMM DD, YYYY hh:mm:ss A"),
                displayTimezone = moment.tz(new Date(), userTimezone).format("z"),
                displayString = "<h1>" + state.translate('Device Information') + "</h1>" +
                        "<div id='vehicleName'><b>" + state.translate('Vehicle Name:') + "</b> " + htmlEscape(currentDevice.name) + "</div>" +
                        "<div id='vehicleDriver'><b>" + state.translate('Driver:') + "</b> " + htmlEscape(accident.driver) + "</div>";

            if (currentDevice.vehicleIdentificationNumber && currentDevice.vehicleIdentificationNumber === "") {
                displayString += "<div id='vehicleInfo'><b>" + state.translate('VIN/Vehicle :') + "</b>" + state.translate(' There was no VIN information for this vehicle.') + "</div>";
            } else {
                displayString += "<div id='vehicleVin'><b>" + state.translate('VIN:' + "</b> " + htmlEscape(currentDevice.vehicleIdentificationNumber) + "</div>";
                if (vin.error === "None") {
                    displayString += "<div id='vehicleInfo'><b>" + state.translate('Vehicle:') + "</b> " + htmlEscape(vin.year) + " " + htmlEscape(vin.make) + " " + htmlEscape(vin.model) + "</div>";
                }
                else {
                    displayString += "<div id='vehicleInfo'><b>" + state.translate('Vehicle:') + "</b>" + state.translate('Vehicle information could not be processed.') + "</div>";
                }
            }
            

            displayString += "<div id='dateOfAccident'><b>" + state.translate('Time of Collision:') + "</b> " + accidentDateTime + "</div>" +
                    "<div id='vehicleImage' style='width:95%;max-width:750px;'>" + accident.imageString + "</div>" +
                    "<div id='vehicleTripHistory'><h1>" + state.translate('Map View') + "</h1>";

            if (accident.trip !== "Unknown") {
                displayString += "<p><a href=https://" + credentials.server + "/" + credentials.database + "/#tripsHistory,dateRange:(endDate:'" + accidentDateAfterArr[0] +
                        "T03:59:59.000Z',startDate:'" + accidentDateArr[0] + "T04:00:00.000Z'),devices:!(" + currentDevice.id +
                        "),routes:(" + currentDevice.id + ":!((start:'" + accident.tripStart + "',stop:'" + accident.tripEnd + "'))) target=_blank>" + state.translate('Trip History') + "</a></p>";
            } else {
                displayString += "<p>" + state.translate('Trip history is unknown.') + "</p>";
            }

            if (accident.longitude && accident.latitude) {
                displayString += "<div id='vehicleTripHistoryMap' style='width:95%;max-width:750px;height:" + mapHeight + ";max-height:550px;'></div></div>" +
                        "<div id='vehicleSpeed'><h1>" + state.translate('Speed Data') + "</h1><b>" state.translate('Speed at Collision:') + "</b> " + (isMetric ? accident.speed + " " + state.translate('km/h') + : (accident.speed * 0.621371192) + " " + state.translate('mph') +
                        "<p><a href=https://" + credentials.server + "/" + credentials.database + "/#speedProfile,dateRange:(endDate:'" + accident.speedEndTime +
                        "',startDate:'" + accident.speedStartTime + "'),device:" + currentDevice.id + " target=_blank>Speed Profile</a></p>" +
                        "<p><b>Graph Start:</b> " + accidentThirtyBefore + "<br><b>Time of Collision:</b> " + accidentDateTime + "<br><b>Graph End:</b> " + accidentThirtyAfter + "</p></div>";
            } else {
                displayString += "<p>Accident location is unknown.</p></div>" +
                        "<div id='vehicleSpeed'><h1>Speed Data</h1><b>Speed at Collision:</b> " + accident.speed + "</div>";
            }

            displayString += "<div id='vehicleRPM'><h1>RPM Data</h1>" +
                    "<p><a href=https://" + credentials.server + "/" + credentials.database + "/#engineDataProfile,dateRange:(endDate:'" + accident.speedEndTime +
                    "',startDate:'" + accident.speedStartTime + "'),device:!(" + currentDevice.id + "),diagnostic:!(DiagnosticEngineSpeedId),showVehicleSpeed:!f target=_blank>RPM Graph</a></p>" +
                    "<p><b>Graph Start:</b> " + accidentThirtyBefore + "<br><b>Time of Collision:</b> " + accidentDateTime + "<br><b>Graph End:</b> " + accidentThirtyAfter + "</p></div>" +
                    "<div id='vehicleAccelerometer'><h1>Accelerometer Data</h1><b>Forward and Braking:</b> " + (isMetric ? (accident.x).toFixed(5) + " m/s^2" : (accident.x * 3.28084).toFixed(5) + " ft/s^2") +
                    "<br><b>Side to Side:</b> " + (isMetric ? (accident.y).toFixed(5) + " m/s^2" : (accident.y * 3.28084).toFixed(5) + " ft/s^2") +
                    "<p><a href=https://" + credentials.server + "/" + credentials.database + "/#engineDataProfile,dateRange:(endDate:'" + accident.speedEndTime +
                    "',startDate:'" + accident.speedStartTime + "'),device:!(" + currentDevice.id + "),diagnostic:!(DiagnosticAccelerationForwardBrakingId,DiagnosticAccelerationSideToSideId),showVehicleSpeed:!f target=_blank>Accelerometer Graph</a></p>" +
                    "<p><b>Graph Start:</b> " + accidentThirtyBefore + "<br><b>Time of Collision:</b> " + accidentDateTime + "<br><b>Graph End:</b> " + accidentThirtyAfter + "</p></div>" +
                    "<div id='errorMargins'><h1>Margin of Error</h1><p>GPS coordinates are accurate to " + (isMetric ? "2.5 Meters" : "8.2 Feet") + "<br>Speed is accurate to " + (isMetric ? "3.6 km/h" : "2.2 mi/h") + "<br>Point of impact is an estimate based on calculated angle from accelerometer axis and may vary</div>" +
                    "<div id='disclaimer'><h1>Disclaimer</h1><p>The preceding report is for illustrative purposes only. The report has been assembled automatically using data reported by a GO device by software in BETA release.  There are many ways in which automatically generated reports can be in error. Some directly measured quantities in the report, such as acceleration, speed, and GPS location, are subject to their usual uncertainties and measurement errors. Derived quantities, such as point of impact, are also subject to potential calculation errors. The vehicle image displayed in the document is a generic image of the vehicle type, it does not serve to portray an accurate image of the exact vehicle or any additions/modifications done to the vehicle such as trailers, this image can also be edited by the user generating the report. The software is still in development and performance characteristics remain uncertain. Accordingly, the report may serve as a starting point for your investigation of an incident, but <i><u>no conclusions should be drawn from it</u></i> without a trained, Geotab expert to interpret it.</p></div>" +
                    "<div id='timedisclaimer'>All times are in " + htmlEscape(displayTimezone) + " ( " + htmlEscape(userTimezone) + " ).</div>";

            hideWaiting();
            document.getElementById("results").innerHTML = displayString;

            if (accident.longitude && accident.latitude) {

                L.mapbox.accessToken = "pk.eyJ1IjoiZ2VvdGFiIiwiYSI6ImNpd2NlaW02MjAxc28yeW9idTR3dmRxdTMifQ.ZH0koA2g2YMMBOcx6EYbwQ";
                var map = L.map("vehicleTripHistoryMap", {
                    zoom: 17,
                    scrollWheelZoom: false
                }).setView([accident.latitude, accident.longitude], 17);
                L.mapbox.styleLayer("mapbox://styles/mapbox/streets-v10").addTo(map);

                var marker = L.marker([accident.latitude, accident.longitude]).addTo(map)
                    .bindPopup("<b>Time of Collision</b><br> " + accidentDateTime + "<br><br><b>Location</b><br> " + accident.address)
                    .openPopup();
            }
        },

        adjustDisplayWidth = function () {
            if (document.getElementById("collisionReconstruction")) {
                datePickerStart.datepicker("hide");
                datePickerEnd.datepicker("hide");
                $("#input-start-date").blur();
                $("#input-end-date").blur();

                var newWidth = document.getElementById("collisionReconstruction").offsetWidth - document.getElementById("options-container").offsetWidth - 37;

                document.getElementById("collisionReconstructionMain").style.width = newWidth + "px";
                mapHeight = Math.floor(newWidth * 0.7) + "px";

                if (document.getElementById("vehicleTripHistoryMap")) {
                    document.getElementById("vehicleTripHistoryMap").style.height = mapHeight;
                }
            }
        };

    searchButton.addEventListener("click", findAccident, false);
    showHistoricDevices.addEventListener("change", function () {
        getDevicesCurrentUser(this.checked);
    }, false);
	exportPdfButton.addEventListener("click", exportPdf);

    return {
        /*
         * Page lifecycle method: initialize is called once when the Add-In first starts
         * Use this function to initialize the Add-In's state such as default values or
         * make API requests (Geotab or external) to ensure interface is ready for the user.
         */
        initialize: function (api, state, callback) {
			elAddin = document.getElementById('collisionReconstruction');
            if (callback) {
                callback();
            }
			console.log(state);
			if (state.translate) {
                state.translate(elAddin || '');
            }
            initialize();
        },

        /*
         * Page lifecycle method: focus is called when the page has finished initialize method
         * and again when a user leaves and returns to your Add-In that has already been initialized.
         * Use this function to refresh state such as vehicles, zones or exceptions which may have
         * been modified since it was first initialized.
         */
        focus: function () {
            // devices must be reloaded when page is focused
            adjustDisplayWidth();

            getDevicesCurrentUser();
        },

        /*
         * Page lifecycle method: blur is called when the user is leaving your Add-In.
         * Use this function to save state or commit changes to a datastore or release memory.
         */
        blur: function () {
        }
    };
};